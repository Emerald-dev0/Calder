"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  getDb,
  emails,
  emailEvents,
  senderIdentities,
  suppressions,
  auditLogs,
  projects,
} from "@calder/db";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "../../../lib/auth";
import { sendTransactional } from "../../../lib/send/transactional";

async function assertProjectAccess(projectId: string) {
  const ctx = await getTenantContext();
  const ids = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!ids.has(projectId)) throw new Error("Project not found.");
  return ctx;
}

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Poll helper for the live toggle.
 *
 * Returns how many messages arrived after `afterId` (or in total, when the
 * client has no anchor yet). Scoped to the project, so it can only ever count
 * this tenant's rows.
 */
export async function countNewMessages(
  projectId: string,
  afterId: string | null
): Promise<{ count: number; newestId: string | null }> {
  await assertProjectAccess(projectId);
  const db = getDb();

  const [newest] = await db
    .select({ id: emails.id, createdAt: emails.createdAt })
    .from(emails)
    .where(eq(emails.projectId, projectId))
    .orderBy(desc(emails.createdAt), desc(emails.id))
    .limit(1);

  if (!newest) return { count: 0, newestId: null };
  if (afterId === newest.id) return { count: 0, newestId: newest.id };

  let anchor: Date | null = null;
  if (afterId) {
    const [row] = await db
      .select({ createdAt: emails.createdAt })
      .from(emails)
      .where(and(eq(emails.id, afterId), eq(emails.projectId, projectId)))
      .limit(1);
    anchor = row?.createdAt ?? null;
  }

  if (!anchor) return { count: 1, newestId: newest.id };

  const rows = await db
    .select({ id: emails.id })
    .from(emails)
    .where(and(eq(emails.projectId, projectId), gt(emails.createdAt, anchor)));
  return { count: rows.length, newestId: newest.id };
}

/**
 * Resend.
 *
 * Deliberately not a copy: it re-reads the original, then calls the shared
 * `sendTransactional`, so the resend passes through the same validation,
 * suppression guard, sender readiness and monthly quota as any other send. It
 * creates a NEW row linked to the original in metadata, with no idempotency
 * key (so it cannot be confused with a replay) and is metered once.
 *
 * An address that bounced between the original and the resend is refused here,
 * by the same guard, with the reason named.
 */
export async function resendEmail(
  projectId: string,
  emailId: string
): Promise<{ ok: true; newId: string }> {
  await assertProjectAccess(projectId);
  const db = getDb();

  const [original] = await db
    .select()
    .from(emails)
    .where(and(eq(emails.id, emailId), eq(emails.projectId, projectId)))
    .limit(1);
  if (!original) throw new Error("Message not found.");
  if (!original.html && !original.text) {
    throw new Error("This message has no stored content to resend.");
  }

  // The original's sender may since have been archived; the send service will
  // refuse it with a specific message, which is the behaviour we want.
  const [sender] = original.senderIdentityId
    ? await db
        .select({ id: senderIdentities.id })
        .from(senderIdentities)
        .where(
          and(
            eq(senderIdentities.id, original.senderIdentityId),
            eq(senderIdentities.projectId, projectId)
          )
        )
        .limit(1)
    : [];

  if (!sender) {
    throw new Error(
      "The sender used for this message is no longer available. Pick a sender in the composer instead."
    );
  }

  const result = await sendTransactional({
    projectId,
    senderId: sender.id,
    to: original.to,
    subject: original.subject,
    html: original.html ?? undefined,
    text: original.text ?? undefined,
    replyTo: original.replyTo ?? undefined,
    stream: original.stream,
    resendOf: original.id,
    metadata: { resendOf: original.id },
  });

  revalidatePath("/emails");
  return { ok: true, newId: result.id };
}

/**
 * Add the recipient of a message to suppressions.
 *
 * Writes `source_email_id` so the row traces back to the message that prompted
 * it, uses `manual` as the reason (an operator decided, even if the trigger was
 * a bounce), and records an audit entry naming the source. An address that is
 * already suppressed is refused rather than silently re-reasoned — the reason
 * decides whether transactional mail is still allowed, so it must not be
 * relaxed by a second click.
 */
export async function addMessageRecipientToSuppressions(
  projectId: string,
  emailId: string
): Promise<{ ok: true }> {
  const ctx = await assertProjectAccess(projectId);
  const db = getDb();

  const [message] = await db
    .select({
      id: emails.id,
      to: emails.to,
      status: emails.status,
    })
    .from(emails)
    .where(and(eq(emails.id, emailId), eq(emails.projectId, projectId)))
    .limit(1);
  if (!message) throw new Error("Message not found.");

  const email = message.to.trim().toLowerCase();
  const [existing] = await db
    .select({ id: suppressions.id, reason: suppressions.reason })
    .from(suppressions)
    .where(and(eq(suppressions.projectId, projectId), eq(suppressions.email, email)))
    .limit(1);
  if (existing) {
    // Never overwrite an unsubscribe with a manual block: the reason decides
    // whether transactional mail is allowed, so quietly changing it would
    // loosen the guard.
    throw new Error(
      `${email} is already suppressed in this project (reason: ${existing.reason}). Nothing changed.`
    );
  }

  await db.insert(suppressions).values({
    id: rid("sup"),
    projectId,
    email,
    reason: "manual",
    sourceEmailId: message.id,
  });

  try {
    const [project] = await db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (project) {
      await db.insert(auditLogs).values({
        id: rid("audit"),
        organizationId: project.organizationId,
        actorUserId: ctx.user?.userId ?? null,
        action: "suppression.added",
        targetType: "suppression",
        targetId: email,
        metadata: { reason: "manual", sourceEmailId: message.id, via: "message-detail" },
      });
    }
  } catch {
    // Auditing must not roll back the suppression itself.
  }

  revalidatePath("/emails");
  revalidatePath("/suppressions");
  return { ok: true };
}

/**
 * Event timeline for one message, re-read on demand so the detail panel can
 * refresh while a message is still in flight without reloading the page.
 */
export async function messageEvents(projectId: string, emailId: string) {
  await assertProjectAccess(projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: emailEvents.id,
      type: emailEvents.type,
      data: emailEvents.data,
      createdAt: emailEvents.createdAt,
    })
    .from(emailEvents)
    .where(and(eq(emailEvents.emailId, emailId), eq(emailEvents.projectId, projectId)))
    .orderBy(emailEvents.createdAt);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
  }));
}
