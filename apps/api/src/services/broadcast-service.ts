import { and, count, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  audiences,
  audienceContacts,
  broadcastLinks,
  broadcastRecipients,
  broadcasts,
  linkClicks,
  contacts,
  senderIdentities,
  suppressions,
  type DbClient,
} from "@calder/db";
import { signUnsubscribeToken } from "@calder/auth";
import { getConfig } from "@calder/config";
import { AppError } from "../errors/index.js";
import { logger } from "@calder/observability";
import { handleSendEmail } from "./email-service.js";
import { isRoleAddress } from "@calder/audiences";

/**
 * Broadcasts: one marketing message to one audience.
 *
 * The design decisions that matter:
 *
 *  - **Materialise, then send.** The recipient list is frozen into
 *    `broadcast_recipients` before the first message leaves. Editing a list, or
 *    a contact unsubscribing mid-send, cannot change who this broadcast was
 *    already sent to. Re-running materialisation is idempotent (unique
 *    broadcast+contact), which is what makes a retried send safe.
 *  - **Skip, don't drop.** Every contact who is not mailable gets a row with a
 *    reason (`unsubscribed`, `suppressed`, `bounced`, `invalid`). "We sent to
 *    4,000 of 4,120" is answerable; "we sent to 4,000" is not.
 *  - **The delivery path is the normal one.** Each recipient becomes a real
 *    `emails` row through `handleSendEmail`, so quota, suppression, sender
 *    verification, the queue and the drain all apply. A broadcast is not a
 *    privileged side channel.
 *  - **A quota refusal stops the broadcast, it does not fail 1,000 times.**
 *    The remaining recipients are marked cancelled and the broadcast pauses
 *    with a reason the dashboard can show.
 */

export const BROADCAST_SEND_CAP = 1000;

export interface CreateBroadcastInput {
  organizationId: string;
  projectId: string;
  name: string;
  senderId: string;
  audienceId: string;
  segmentId?: string | null;
  subject: string;
  previewText?: string | null;
  html: string;
  text?: string | null;
  replyTo?: string | null;
  scheduledAt?: Date | null;
  timezone?: string | null;
  trackingOpens?: boolean;
  trackingClicks?: boolean;
  createdBy?: string | null;
}

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** The unsubscribe URL a marketing recipient sees. Signed, project-scoped. */
export function broadcastUnsubscribeUrl(projectId: string, email: string): string {
  const appUrl = (process.env.APP_URL ?? "https://calder.click").replace(/\/$/, "");
  return `${appUrl}/v1/unsubscribe?token=${signUnsubscribeToken(projectId, email)}`;
}

/**
 * Personalisation, deliberately tiny: three substitutions and no template
 * language. Anything richer belongs in the template that produced the HTML.
 */
export function personalize(
  html: string,
  contact: { email: string; firstName: string | null; lastName: string | null }
): string {
  return html
    .replaceAll("{{email}}", contact.email)
    .replaceAll("{{first_name}}", contact.firstName ?? "there")
    .replaceAll("{{last_name}}", contact.lastName ?? "");
}

/**
 * Extract, register and rewrite links for click counting.
 *
 * Registration happens once per broadcast, before the first recipient, so the
 * token a reader clicks always resolves. The unsubscribe and resubscribe links
 * are never rewritten: wrapping an opt-out in a tracking redirect is hostile
 * and, in several jurisdictions, not compliant.
 */
export async function prepareLinks(
  db: DbClient,
  input: { broadcastId: string; html: string }
): Promise<{ html: string; links: number }> {
  const appUrl = (getConfig().APP_URL ?? "https://calder.click").replace(/\/$/, "");
  const urls = new Set<string>();
  for (const match of input.html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const url = match[1]!;
    if (url.includes("/v1/unsubscribe") || url.includes("/v1/resubscribe")) continue;
    urls.add(url);
  }
  if (urls.size === 0) return { html: input.html, links: 0 };

  const existing = await db
    .select({ token: broadcastLinks.shortToken, url: broadcastLinks.originalUrl })
    .from(broadcastLinks)
    .where(eq(broadcastLinks.broadcastId, input.broadcastId));
  const byUrl = new Map(existing.map((row) => [row.url, row.token]));

  for (const url of urls) {
    if (byUrl.has(url)) continue;
    const token = randomUUID().replace(/-/g, "").slice(0, 24);
    await db
      .insert(broadcastLinks)
      .values({
        id: rid("bcl"),
        broadcastId: input.broadcastId,
        originalUrl: url,
        shortToken: token,
      })
      .onConflictDoNothing();
    byUrl.set(url, token);
  }

  const html = input.html.replace(/href="(https?:\/\/[^"]+)"/g, (match, url: string) => {
    if (url.includes("/v1/unsubscribe") || url.includes("/v1/resubscribe")) return match;
    const token = byUrl.get(url);
    return token ? `href="${appUrl}/v1/broadcasts/click/${token}"` : match;
  });

  return { html, links: byUrl.size };
}

/** Record a click and return where to send the reader. Null = unknown token. */
export async function recordClick(
  db: DbClient,
  token: string,
  meta: { userAgent?: string | null }
): Promise<string | null> {
  const [link] = await db
    .select({ id: broadcastLinks.id, url: broadcastLinks.originalUrl })
    .from(broadcastLinks)
    .where(eq(broadcastLinks.shortToken, token))
    .limit(1);
  if (!link) return null;

  await db
    .update(broadcastLinks)
    .set({ clickCount: sql`${broadcastLinks.clickCount} + 1` })
    .where(eq(broadcastLinks.id, link.id));
  await db.insert(linkClicks).values({
    id: rid("clk"),
    broadcastLinkId: link.id,
    userAgentHash: meta.userAgent ? sha256(meta.userAgent).slice(0, 64) : null,
  });
  return link.url;
}

function sha256(value: string): string {
  // Local import keeps node:crypto out of the module's top-level surface.
  return createHash("sha256").update(value).digest("hex");
}

export async function createBroadcast(db: DbClient, input: CreateBroadcastInput) {
  const [sender] = await db
    .select({
      id: senderIdentities.id,
      email: senderIdentities.email,
      status: senderIdentities.status,
      archivedAt: senderIdentities.archivedAt,
    })
    .from(senderIdentities)
    .where(
      and(eq(senderIdentities.id, input.senderId), eq(senderIdentities.projectId, input.projectId))
    )
    .limit(1);
  if (!sender)
    throw new AppError("validation_error", "Sender does not belong to this project.", 400);
  if (sender.archivedAt) {
    throw new AppError("validation_error", "That sender is archived and cannot send.", 400);
  }
  if (sender.status !== "verified") {
    throw new AppError(
      "validation_error",
      "That sender is not verified. Verify it before scheduling a broadcast.",
      400
    );
  }

  const [audience] = await db
    .select({ id: audiences.id, archivedAt: audiences.archivedAt })
    .from(audiences)
    .where(and(eq(audiences.id, input.audienceId), eq(audiences.projectId, input.projectId)))
    .limit(1);
  if (!audience)
    throw new AppError("validation_error", "Audience does not belong to this project.", 400);
  if (audience.archivedAt) {
    throw new AppError("validation_error", "That audience is archived and cannot be mailed.", 400);
  }

  if (input.subject.trim().length === 0)
    throw new AppError("validation_error", "Subject is required.", 400);
  if (input.html.trim().length === 0)
    throw new AppError("validation_error", "Body is required.", 400);

  const [row] = await db
    .insert(broadcasts)
    .values({
      id: rid("bc"),
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name.trim().slice(0, 255) || "Untitled broadcast",
      status: "draft",
      senderId: sender.id,
      replyTo: input.replyTo?.slice(0, 320) ?? null,
      subject: input.subject.slice(0, 998),
      previewText: input.previewText?.slice(0, 255) ?? null,
      html: input.html,
      text: input.text ?? null,
      audienceId: audience.id,
      segmentId: input.segmentId ?? null,
      trackingOpens: input.trackingOpens ?? true,
      trackingClicks: input.trackingClicks ?? true,
      scheduledAt: input.scheduledAt ?? null,
      timezone: input.timezone ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row!;
}

export async function listBroadcasts(db: DbClient, projectId: string) {
  const rows = await db
    .select({
      id: broadcasts.id,
      name: broadcasts.name,
      status: broadcasts.status,
      subject: broadcasts.subject,
      audienceId: broadcasts.audienceId,
      scheduledAt: broadcasts.scheduledAt,
      startedAt: broadcasts.startedAt,
      completedAt: broadcasts.completedAt,
      recipientCount: broadcasts.recipientCount,
      pausedReason: broadcasts.pausedReason,
      createdAt: broadcasts.createdAt,
    })
    .from(broadcasts)
    .where(eq(broadcasts.projectId, projectId))
    .orderBy(sql`${broadcasts.createdAt} DESC`)
    .limit(100);
  return rows;
}

export async function getBroadcast(db: DbClient, projectId: string, id: string) {
  const [row] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, id), eq(broadcasts.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export async function broadcastReport(db: DbClient, broadcastId: string) {
  const counts = await db
    .select({
      status: broadcastRecipients.status,
      skipReason: broadcastRecipients.skipReason,
      total: count(),
    })
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.broadcastId, broadcastId))
    .groupBy(broadcastRecipients.status, broadcastRecipients.skipReason);

  const byStatus = (status: string) =>
    counts.filter((c) => c.status === status).reduce((sum, c) => sum + Number(c.total), 0);
  const skipped = counts
    .filter((c) => c.status === "skipped")
    .map((c) => ({ reason: c.skipReason ?? "unknown", total: Number(c.total) }));

  const links = await db
    .select({
      id: broadcastLinks.id,
      url: broadcastLinks.originalUrl,
      clicks: broadcastLinks.clickCount,
    })
    .from(broadcastLinks)
    .where(eq(broadcastLinks.broadcastId, broadcastId));

  return {
    total: counts.reduce((sum, c) => sum + Number(c.total), 0),
    pending: byStatus("pending"),
    queued: byStatus("queued"),
    sent: byStatus("sent"),
    delivered: byStatus("delivered"),
    bounced: byStatus("bounced"),
    failed: byStatus("failed"),
    skipped: byStatus("skipped"),
    cancelled: byStatus("cancelled"),
    skippedByReason: skipped,
    links,
  };
}

/**
 * Freeze the recipient list.
 *
 * A contact is included when the contact itself is `subscribed` AND their
 * membership is `subscribed`. Everyone else gets a row explaining why not.
 * Suppression is checked here as well as at delivery: catching a hard bounce at
 * materialisation keeps the report honest and avoids 3,000 doomed API calls.
 */
export async function materializeRecipients(
  db: DbClient,
  input: { broadcastId: string; projectId: string; audienceId: string }
): Promise<{ included: number; skipped: number }> {
  const members = await db
    .select({
      contactId: contacts.id,
      email: contacts.email,
      status: contacts.status,
      membership: audienceContacts.status,
      unsubscribedAt: contacts.unsubscribedAt,
    })
    .from(audienceContacts)
    .innerJoin(contacts, eq(audienceContacts.contactId, contacts.id))
    .where(eq(audienceContacts.audienceId, input.audienceId));

  const suppressed = await db
    .select({ email: suppressions.email, reason: suppressions.reason })
    .from(suppressions)
    .where(eq(suppressions.projectId, input.projectId));
  const suppressedByEmail = new Map(suppressed.map((row) => [row.email.toLowerCase(), row.reason]));

  const rows: Array<{
    id: string;
    broadcastId: string;
    contactId: string;
    status: "pending" | "skipped";
    skipReason:
      "unsubscribed" | "suppressed" | "bounced" | "complained" | "invalid" | "duplicate" | null;
  }> = [];

  for (const member of members) {
    const email = member.email.toLowerCase();
    let skip: (typeof rows)[number]["skipReason"] = null;

    if (member.status === "unsubscribed" || member.membership === "unsubscribed")
      skip = "unsubscribed";
    else if (member.status === "bounced") skip = "bounced";
    else if (member.status === "complained") skip = "complained";
    else if (member.status !== "subscribed") skip = "invalid";
    else if (isRoleAddress(email)) skip = "invalid";
    else {
      const reason = suppressedByEmail.get(email);
      if (reason === "bounce") skip = "bounced";
      else if (reason === "complaint") skip = "complained";
      else if (reason) skip = "suppressed";
    }

    rows.push({
      id: rid("bcr"),
      broadcastId: input.broadcastId,
      contactId: member.contactId,
      status: skip ? "skipped" : "pending",
      skipReason: skip,
    });
  }

  // Chunked: a 5,000-row single INSERT is fine for Postgres but trips every
  // parameter limit once the row grows. 500 keeps the statement small.
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(broadcastRecipients)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
  }

  const included = rows.filter((row) => row.status === "pending").length;
  return { included, skipped: rows.length - included };
}

export interface SendBroadcastResult {
  status: "sending" | "sent" | "paused" | "failed";
  attempted: number;
  queued: number;
  skipped: number;
  failed: number;
  remaining: number;
  reason?: string;
}

/**
 * Post-send notice for a broadcast. Best effort: the send already happened and
 * the report page is the record, so a mail outage must not become a send error.
 */
async function notifyBroadcastOutcome(
  db: DbClient,
  input: {
    organizationId: string;
    broadcastId: string;
    name: string;
    status: "sent" | "paused";
    reason?: string;
  }
): Promise<void> {
  try {
    const counts = await db
      .select({ status: broadcastRecipients.status, total: count() })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.broadcastId, input.broadcastId))
      .groupBy(broadcastRecipients.status);
    const total = (status: string) =>
      Number(counts.find((row) => row.status === status)?.total ?? 0);

    const { sendOrganizationEmail } = await import("@calder/notify");
    await sendOrganizationEmail(db, {
      id:
        input.status === "sent" ? "operations.broadcast_completed" : "operations.broadcast_paused",
      organizationId: input.organizationId,
      idempotencyKey: `broadcast:${input.broadcastId}:${input.status}`,
      data: {
        broadcastName: input.name,
        recipients: total("sent") + total("delivered") + total("queued"),
        delivered: total("delivered"),
        bounced: total("bounced"),
        unsubscribed: total("skipped"),
        complained: total("failed"),
        sent: total("sent") + total("delivered"),
        reason: input.reason,
        reportUrl: `${getConfig().APP_URL.replace(/\/$/, "")}/broadcasts/${input.broadcastId}`,
      },
    });
  } catch (err) {
    logger.warn(
      { broadcastId: input.broadcastId, err: err instanceof Error ? err.message : "unknown" },
      "Broadcast outcome email failed"
    );
  }
}

export async function sendBroadcast(
  db: DbClient,
  input: {
    broadcastId: string;
    projectId: string;
    organizationId: string;
    env: "test" | "live";
    requestId: string;
    limit?: number;
  }
): Promise<SendBroadcastResult> {
  const broadcast = await getBroadcast(db, input.projectId, input.broadcastId);
  if (!broadcast) throw new AppError("not_found", "Broadcast not found", 404);
  if (!["draft", "paused", "scheduled", "queued"].includes(broadcast.status)) {
    throw new AppError(
      "conflict",
      `A broadcast in status "${broadcast.status}" cannot be sent.`,
      409
    );
  }
  if (!broadcast.html) throw new AppError("validation_error", "Broadcast has no body.", 400);

  const [sender] = await db
    .select({ email: senderIdentities.email, displayName: senderIdentities.displayName })
    .from(senderIdentities)
    .where(eq(senderIdentities.id, broadcast.senderId))
    .limit(1);
  if (!sender) throw new AppError("validation_error", "Broadcast sender no longer exists.", 400);

  await materializeRecipients(db, {
    broadcastId: broadcast.id,
    projectId: input.projectId,
    audienceId: broadcast.audienceId,
  });

  await db
    .update(broadcasts)
    .set({
      status: "sending",
      startedAt: broadcast.startedAt ?? new Date(),
      pausedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, broadcast.id));

  // Register links once, before the first recipient, so every message carries
  // tokens that already resolve.
  const prepared = broadcast.trackingClicks
    ? await prepareLinks(db, {
        broadcastId: broadcast.id,
        html: broadcast.html ?? "",
      })
    : { html: broadcast.html ?? "", links: 0 };

  const limit = Math.min(Math.max(input.limit ?? BROADCAST_SEND_CAP, 1), BROADCAST_SEND_CAP);
  const pending = await db
    .select({ id: broadcastRecipients.id, contactId: broadcastRecipients.contactId })
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcast.id),
        eq(broadcastRecipients.status, "pending")
      )
    )
    .limit(limit);

  let queued = 0;
  let failed = 0;
  let skipped = 0;
  let stopped: string | undefined;

  for (const recipient of pending) {
    const [contact] = await db
      .select({
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(eq(contacts.id, recipient.contactId))
      .limit(1);
    if (!contact) {
      await db
        .update(broadcastRecipients)
        .set({ status: "skipped", skipReason: "invalid", updatedAt: new Date() })
        .where(eq(broadcastRecipients.id, recipient.id));
      skipped++;
      continue;
    }

    const unsubscribeUrl = broadcastUnsubscribeUrl(input.projectId, contact.email);
    const html = personalize(prepared.html, contact);

    try {
      const result = await handleSendEmail({
        projectId: input.projectId,
        organizationId: input.organizationId,
        apiKeyId: "broadcast",
        env: input.env,
        requestId: `${input.requestId}:${recipient.id}`,
        idempotencyKey: `broadcast:${broadcast.id}:${recipient.contactId}`,
        broadcastId: broadcast.id,
        input: {
          from: broadcast.senderId,
          stream: "marketing",
          to: contact.email,
          subject: personalize(broadcast.subject, contact),
          html,
          text: broadcast.text ? personalize(broadcast.text, contact) : undefined,
          reply_to: broadcast.replyTo ?? undefined,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          metadata: { broadcast_id: broadcast.id, audience_id: broadcast.audienceId },
        },
      });

      await db
        .update(broadcastRecipients)
        .set({ status: "queued", emailId: result.response.id, updatedAt: new Date() })
        .where(eq(broadcastRecipients.id, recipient.id));
      queued++;
    } catch (err) {
      const code = err instanceof AppError ? err.code : "internal_error";

      if (code === "plan_limit_reached") {
        // Stop cleanly: one refusal is a quota fact, repeating it 900 times is
        // an outage. The remaining recipients are cancelled, not failed.
        stopped = "plan_limit_reached";
        break;
      }
      if (code === "suppressed") {
        await db
          .update(broadcastRecipients)
          .set({ status: "skipped", skipReason: "suppressed", updatedAt: new Date() })
          .where(eq(broadcastRecipients.id, recipient.id));
        skipped++;
        continue;
      }
      if (code === "validation_error") {
        await db
          .update(broadcastRecipients)
          .set({ status: "skipped", skipReason: "invalid", updatedAt: new Date() })
          .where(eq(broadcastRecipients.id, recipient.id));
        skipped++;
        continue;
      }

      logger.warn({ err, broadcastId: broadcast.id }, "Broadcast recipient failed");
      await db
        .update(broadcastRecipients)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(broadcastRecipients.id, recipient.id));
      failed++;
    }
  }

  const [remainingRow] = await db
    .select({ total: count() })
    .from(broadcastRecipients)
    .where(
      and(
        eq(broadcastRecipients.broadcastId, broadcast.id),
        eq(broadcastRecipients.status, "pending")
      )
    );
  const remaining = Number(remainingRow?.total ?? 0);

  let status: SendBroadcastResult["status"];
  if (stopped) {
    status = "paused";
    await db
      .update(broadcasts)
      .set({
        status: "paused",
        pausedReason:
          "The plan's email allowance ran out mid-send. Remaining recipients were cancelled; upgrade or wait for the period reset, then resume.",
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcast.id));
    await db
      .update(broadcastRecipients)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(broadcastRecipients.broadcastId, broadcast.id),
          eq(broadcastRecipients.status, "pending")
        )
      );
  } else if (remaining === 0) {
    status = "sent";
    await db
      .update(broadcasts)
      .set({
        status: "sent",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, broadcast.id));
  } else {
    status = "sending";
  }

  const [countRow] = await db
    .select({ total: count() })
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.broadcastId, broadcast.id));
  await db
    .update(broadcasts)
    .set({ recipientCount: Number(countRow?.total ?? 0), updatedAt: new Date() })
    .where(eq(broadcasts.id, broadcast.id));

  // A broadcast that finishes (or stops itself) while nobody is watching is
  // the normal case: sends run in the background. Tell the workspace, with the
  // numbers, so "did my campaign go out?" never needs a refresh.
  if (status === "sent" || status === "paused") {
    await notifyBroadcastOutcome(db, {
      organizationId: input.organizationId,
      broadcastId: broadcast.id,
      name: broadcast.name,
      status,
      reason: status === "paused" ? "the plan's email allowance ran out mid-send" : undefined,
    });
  }

  return {
    status,
    attempted: pending.length,
    queued,
    skipped,
    failed,
    remaining: stopped ? 0 : remaining,
    reason: stopped,
  };
}

export async function cancelBroadcast(
  db: DbClient,
  projectId: string,
  id: string
): Promise<boolean> {
  const broadcast = await getBroadcast(db, projectId, id);
  if (!broadcast) return false;
  if (broadcast.status === "sent") {
    throw new AppError("conflict", "A sent broadcast cannot be cancelled.", 409);
  }
  await db
    .update(broadcasts)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(broadcasts.id, id));
  await db
    .update(broadcastRecipients)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(broadcastRecipients.broadcastId, id), eq(broadcastRecipients.status, "pending")));
  return true;
}

/** Update a draft. Copy is frozen once anything has been sent. */
export async function updateBroadcast(
  db: DbClient,
  projectId: string,
  id: string,
  patch: {
    name?: string;
    subject?: string;
    previewText?: string | null;
    html?: string;
    text?: string | null;
    replyTo?: string | null;
    senderId?: string;
    audienceId?: string;
    scheduledAt?: Date | null;
  }
) {
  const broadcast = await getBroadcast(db, projectId, id);
  if (!broadcast) throw new AppError("not_found", "Broadcast not found", 404);
  if (!["draft", "paused", "scheduled"].includes(broadcast.status)) {
    throw new AppError(
      "conflict",
      "Only a draft, paused or scheduled broadcast can be edited.",
      409
    );
  }
  if (patch.senderId || patch.audienceId) {
    // Re-validate against this project rather than trusting the caller.
    if (patch.senderId) {
      const [sender] = await db
        .select({ id: senderIdentities.id })
        .from(senderIdentities)
        .where(
          and(
            eq(senderIdentities.id, patch.senderId),
            eq(senderIdentities.projectId, projectId),
            eq(senderIdentities.status, "verified"),
            isNull(senderIdentities.archivedAt)
          )
        )
        .limit(1);
      if (!sender) throw new AppError("validation_error", "Sender is not usable.", 400);
    }
    if (patch.audienceId) {
      const [audience] = await db
        .select({ id: audiences.id })
        .from(audiences)
        .where(
          and(
            eq(audiences.id, patch.audienceId),
            eq(audiences.projectId, projectId),
            isNull(audiences.archivedAt)
          )
        )
        .limit(1);
      if (!audience) throw new AppError("validation_error", "Audience is not usable.", 400);
    }
  }

  const [row] = await db
    .update(broadcasts)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.slice(0, 255) } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject.slice(0, 998) } : {}),
      ...(patch.previewText !== undefined ? { previewText: patch.previewText } : {}),
      ...(patch.html !== undefined ? { html: patch.html } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.replyTo !== undefined ? { replyTo: patch.replyTo } : {}),
      ...(patch.senderId !== undefined ? { senderId: patch.senderId } : {}),
      ...(patch.audienceId !== undefined ? { audienceId: patch.audienceId } : {}),
      ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt } : {}),
      updatedAt: new Date(),
    })
    .where(eq(broadcasts.id, id))
    .returning();
  return row!;
}

/** Recipient rows for one broadcast, used by the report page. */
export async function listBroadcastRecipients(db: DbClient, broadcastId: string, limit = 100) {
  return db
    .select({
      id: broadcastRecipients.id,
      email: contacts.email,
      status: broadcastRecipients.status,
      skipReason: broadcastRecipients.skipReason,
      emailId: broadcastRecipients.emailId,
    })
    .from(broadcastRecipients)
    .innerJoin(contacts, eq(broadcastRecipients.contactId, contacts.id))
    .where(eq(broadcastRecipients.broadcastId, broadcastId))
    .orderBy(sql`${broadcastRecipients.createdAt} ASC`)
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Send a single test copy to the operator. Never touches recipient rows. */
export async function sendBroadcastTest(
  db: DbClient,
  input: {
    broadcastId: string;
    projectId: string;
    organizationId: string;
    env: "test" | "live";
    requestId: string;
    to: string;
  }
): Promise<{ emailId: string }> {
  const broadcast = await getBroadcast(db, input.projectId, input.broadcastId);
  if (!broadcast) throw new AppError("not_found", "Broadcast not found", 404);
  if (!broadcast.html) throw new AppError("validation_error", "Broadcast has no body.", 400);

  const result = await handleSendEmail({
    projectId: input.projectId,
    organizationId: input.organizationId,
    apiKeyId: "broadcast",
    env: input.env,
    requestId: `${input.requestId}:test`,
    idempotencyKey: `broadcast-test:${broadcast.id}:${Date.now()}`,
    broadcastId: broadcast.id,
    input: {
      from: broadcast.senderId,
      // A test send is transactional: it must reach the operator even if they
      // unsubscribed from the marketing list they are testing.
      stream: "transactional",
      to: input.to,
      subject: `[TEST] ${broadcast.subject}`.slice(0, 998),
      html: broadcast.html ?? "",
      text: broadcast.text ?? undefined,
      metadata: { broadcast_test: broadcast.id },
    },
  });
  return { emailId: result.response.id };
}

/** Used by the report page to show "N in list" without sending. */
export async function previewAudienceSize(db: DbClient, audienceId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(audienceContacts)
    .where(
      and(eq(audienceContacts.audienceId, audienceId), eq(audienceContacts.status, "subscribed"))
    );
  return Number(row?.total ?? 0);
}
