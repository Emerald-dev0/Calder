import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  getDb,
  emails,
  emailEvents,
  senderIdentities,
  findBlockingSuppression,
  describeBlock,
  withProjectSendingEligibility,
} from "@calder/db";
import { sendEmailSchema } from "@calder/validation";
import { createQueue } from "@calder/queue";
import { scheduleDeliveryDrain } from "./wake-drain";
import { assertDashboardAdmissionAllowed } from "../sending-eligibility";

/**
 * The dashboard's transactional send path.
 *
 * This exists so that "compose" and "resend" cannot diverge. Both call
 * `sendTransactional`, which runs the same gates the public API runs, in the
 * same order:
 *
 *   1. schema validation            (@calder/validation — the API's own schema)
 *   2. sender verification          (exists, belongs to this project, ready)
 *   3. suppression                  (@calder/db guard — stream aware, org aware)
 *   4. plan quota + org eligibility (withProjectSendingEligibility)
 *   5. persist + queued event + enqueue
 *
 * It deliberately does NOT re-implement any of those rules. The one thing it
 * adds over the API path is `apiKeyId: "dashboard"` in metadata, so a row can
 * say it came from a signed-in session rather than a key.
 */

export interface SendTransactionalInput {
  projectId: string;
  /** Sender identity id (sender_...) — never a bare address from the UI. */
  senderId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; contentType?: string; contentBase64: string }> | null;
  scheduledAt?: string;
  stream?: "transactional" | "marketing";
  /** Set when this message is a resend of another one. */
  resendOf?: string;
  metadata?: Record<string, unknown>;
}

export interface SendTransactionalResult {
  id: string;
  status: string;
}

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function sendTransactional(
  input: SendTransactionalInput
): Promise<SendTransactionalResult> {
  const db = getDb();

  // ── 1. Sender ──────────────────────────────────────────────────────────────
  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(
      and(eq(senderIdentities.id, input.senderId), eq(senderIdentities.projectId, input.projectId))
    )
    .limit(1);
  if (!sender) throw new Error("Choose a sender from this project.");
  if (sender.archivedAt) throw new Error(`${sender.email} is archived and cannot send.`);
  if (sender.status !== "verified" && sender.status !== "connected") {
    throw new Error(`${sender.email} isn't ready to send (status: ${sender.status}).`);
  }
  if (sender.archivedAt) throw new Error(`${sender.email} is archived. Unarchive it to send.`);

  // ── 2. Schema validation, using the API's schema ───────────────────────────
  const parsed = sendEmailSchema.safeParse({
    from: sender.id,
    to: input.to.trim().toLowerCase(),
    subject: input.subject,
    html: input.html,
    text: input.text,
    cc: input.cc ? input.cc.trim().toLowerCase() : undefined,
    bcc: input.bcc ? input.bcc.trim().toLowerCase() : undefined,
    reply_to: input.replyTo || undefined,
    stream: input.stream ?? "transactional",
    metadata: input.metadata,
    attachments: input.attachments ?? undefined,
    scheduled_at: input.scheduledAt || undefined,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(
      first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input."
    );
  }
  const valid = parsed.data;

  // ── 3. Suppression, through the shared guard ───────────────────────────────
  // Transactional stream: an unsubscribe does not block this, a bounce or
  // complaint from any project in the workspace does.
  const stream = valid.stream === "marketing" ? "marketing" : "transactional";
  const blocked = await findBlockingSuppression(db, {
    projectId: input.projectId,
    email: valid.to,
    stream,
  });
  if (blocked) throw new Error(`${describeBlock(blocked)} The email was not queued.`);

  // Recipients that ride along are checked with the same rule, so a Cc cannot
  // smuggle past a bounce that blocked the To address.
  for (const extra of [valid.cc, valid.bcc].filter(Boolean) as string[]) {
    const alsoBlocked = await findBlockingSuppression(db, {
      projectId: input.projectId,
      email: extra,
      stream,
    });
    if (alsoBlocked) throw new Error(`${extra}: ${describeBlock(alsoBlocked)}`);
  }

  // ── 4 + 5. Quota admission, persist, enqueue ───────────────────────────────
  const emailId = rid("em");
  const queuedEventId = rid("ev");
  const metadata: Record<string, unknown> = {
    ...(valid.metadata ?? {}),
    apiKeyId: "dashboard",
    ...(input.resendOf ? { resendOf: input.resendOf } : {}),
  };

  const admission = await withProjectSendingEligibility(
    db,
    { projectId: input.projectId, env: "live" },
    async (tx) => {
      await tx.insert(emails).values({
        id: emailId,
        projectId: input.projectId,
        // A fresh key every time: a resend is a new message, not a replay.
        idempotencyKey: null,
        from: sender.email,
        senderIdentityId: sender.id,
        fromName: sender.displayName,
        to: valid.to,
        cc: valid.cc ?? null,
        bcc: valid.bcc ?? null,
        replyTo: valid.reply_to ?? null,
        subject: valid.subject ?? "",
        html: valid.html ?? null,
        text: valid.text ?? null,
        metadata,
        attachments: valid.attachments ?? null,
        scheduledFor: valid.scheduled_at ? new Date(valid.scheduled_at) : null,
        stream,
        status: "queued",
        env: "live",
        attemptCount: 0,
      });
      await tx.insert(emailEvents).values({
        id: queuedEventId,
        emailId,
        projectId: input.projectId,
        type: "queued",
        data: {
          via: "dashboard",
          ...(input.resendOf ? { resendOf: input.resendOf } : {}),
        },
      });
      return true;
    }
  );

  if (!admission.allowed) {
    // Turns a plan quota refusal into the dashboard's wording, and anything
    // else into a generic refusal. Nothing was persisted.
    assertDashboardAdmissionAllowed(admission.decision);
  }

  const queue = createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  });
  await queue.enqueue("send-email", { emailId, projectId: input.projectId });
  scheduleDeliveryDrain();

  await db
    .update(senderIdentities)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(senderIdentities.id, sender.id), eq(senderIdentities.projectId, input.projectId))
    );

  return { id: emailId, status: "queued" };
}

/**
 * Message id for a new record created by the dashboard.
 * Exported so tests can assert the shape without duplicating the regex.
 */
export const DASHBOARD_MESSAGE_ID = /^em_[a-f0-9]{24}$/;
