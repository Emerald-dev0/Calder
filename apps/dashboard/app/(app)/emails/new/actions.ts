"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, senderIdentities, suppressions, emails, emailEvents } from "@calder/db";
import { createQueue } from "@calder/queue";
import { getTenantContext } from "../../../../lib/auth";

const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/;

export interface ComposerAttachment {
  filename: string;
  contentType?: string;
  contentBase64: string;
}

export interface ComposeInput {
  projectId: string;
  senderId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  scheduledAt?: string;
  attachments?: ComposerAttachment[];
}

function cleanList(list: string[] | undefined, field: string, required: boolean): string[] {
  const out = (list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (required && out.length === 0) throw new Error(`Add at least one ${field} recipient.`);
  if (out.length > 50) throw new Error(`Too many ${field} recipients (max 50).`);
  for (const e of out) {
    if (!EMAIL_RE.test(e)) throw new Error(`Invalid ${field} address: ${e}.`);
  }
  return [...new Set(out)];
}

/**
 * Composer send: same contract as the API (persist → enqueue → worker),
 * executed through the dashboard session. Suppressed recipients block the
 * send with a named error instead of silently queuing.
 */
export async function sendComposerEmail(
  input: ComposeInput
): Promise<{ ok: true; emailId: string }> {
  const ctx = await getTenantContext();
  const projectIds = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!projectIds.has(input.projectId)) throw new Error("Project not found.");
  const db = getDb();

  const [sender] = await db
    .select()
    .from(senderIdentities)
    .where(
      and(eq(senderIdentities.id, input.senderId), eq(senderIdentities.projectId, input.projectId))
    )
    .limit(1);
  if (!sender) throw new Error("Choose a sender from this project.");
  if (sender.status !== "verified" && sender.status !== "connected") {
    throw new Error(`${sender.email} isn't ready (status: ${sender.status}).`);
  }

  const to = cleanList(input.to, "To", true);
  const cc = cleanList(input.cc, "Cc", false);
  const bcc = cleanList(input.bcc, "Bcc", false);
  const subject = input.subject.trim();
  if (!subject) throw new Error("Add a subject.");
  if (subject.length > 998) throw new Error("Subject is too long (max 998).");
  if (!input.text.trim()) throw new Error("Write a message.");
  if (input.replyTo && !EMAIL_RE.test(input.replyTo.trim())) {
    throw new Error("Invalid reply-to address.");
  }

  const suppressedRows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(eq(suppressions.projectId, input.projectId));
  const suppressed = new Set(suppressedRows.map((r) => r.email.toLowerCase()));
  const blocked = [...to, ...cc, ...bcc].filter((e) => suppressed.has(e));
  if (blocked.length > 0) {
    throw new Error(
      `Suppressed recipient${blocked.length > 1 ? "s" : ""}: ${blocked.join(", ")}. Lift the suppression to send.`
    );
  }

  // Quota gate parity with the API (PRICING §5 hard caps): the composer
  // inserts directly rather than going through /v1/emails, so it enforces
  // the same limit here. Org id for "org_avenor" matches
  // apps/api/src/lib/quotas.ts (INTERNAL_ORG_ID) — never throttle Calder's
  // own transactional mail.
  {
    const { projects, orgAcceptedLiveInPeriod, orgUsagePeriod, resolveOrgTier } =
      await import("@calder/db");
    const { planEmailsLimit, PLAN_LIMITS } = await import("@calder/config");
    const [proj] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (proj && proj.organizationId !== "org_avenor") {
      const period = await orgUsagePeriod(db, proj.organizationId);
      const [tier, usage] = await Promise.all([
        resolveOrgTier(db, proj.organizationId),
        orgAcceptedLiveInPeriod(db, proj.organizationId, period),
      ]);
      const limit = planEmailsLimit(tier);
      if (limit !== null && usage + 1 > limit) {
        const display =
          Object.values(PLAN_LIMITS).find((p) => p.tier === tier)?.displayName ?? tier;
        throw new Error(
          `Plan limit reached: the ${display} plan allows ${limit.toLocaleString("en-US")} emails ` +
            `per period; ${usage.toLocaleString("en-US")} used already. ` +
            `Usage resets ${period.end.toISOString().slice(0, 10)} — upgrade on the Usage page to send now.`
        );
      }
    }
  }

  const attachments = (input.attachments ?? []).slice(0, 10).map((a) => {
    const filename = a.filename.split(/[\\/]/).pop() ?? "";
    if (!filename) throw new Error("Attachment filenames cannot contain path separators.");
    if (!a.contentBase64) throw new Error(`Attachment ${filename} is empty.`);
    return { filename, contentType: a.contentType, contentBase64: a.contentBase64 };
  });
  const totalB64 = attachments.reduce((n, a) => n + a.contentBase64.length, 0);
  if (totalB64 > 25 * 1024 * 1024) {
    throw new Error("Attachments exceed 25 MB of base64 in total.");
  }

  let scheduledFor: Date | null = null;
  let delayMs: number | undefined;
  if (input.scheduledAt) {
    const at = new Date(input.scheduledAt).getTime();
    if (Number.isNaN(at) || at <= Date.now())
      throw new Error("Scheduled time must be in the future.");
    if (at - Date.now() > 366 * 24 * 60 * 60 * 1000) {
      throw new Error("Scheduled time is at most a year ahead.");
    }
    scheduledFor = new Date(at);
    delayMs = Math.max(0, at - Date.now());
  }

  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(emails).values({
    id: emailId,
    projectId: input.projectId,
    from: sender.email,
    senderIdentityId: sender.id,
    fromName: sender.displayName,
    to: to.join(", "),
    cc: cc.length > 0 ? cc.join(", ") : null,
    bcc: bcc.length > 0 ? bcc.join(", ") : null,
    replyTo: input.replyTo?.trim() || null,
    subject,
    text: input.text,
    scheduledFor,
    attachments: attachments.length > 0 ? attachments : null,
    status: "queued",
  });
  await db.insert(emailEvents).values({
    id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    emailId,
    projectId: input.projectId,
    type: "queued",
    data: { via: "dashboard-composer" },
  });
  const queue = createQueue<{ emailId: string; projectId: string }>("email:send", {
    maxAttempts: 5,
  });
  if (delayMs !== undefined && delayMs > 0) {
    await queue.enqueueDelayed("send-email", { emailId, projectId: input.projectId }, delayMs);
  } else {
    await queue.enqueue("send-email", { emailId, projectId: input.projectId });
  }
  await db
    .update(senderIdentities)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(eq(senderIdentities.id, sender.id));
  return { ok: true, emailId };
}
