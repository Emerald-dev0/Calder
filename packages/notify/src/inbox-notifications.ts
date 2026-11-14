import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  emailsSentSince,
  inboxMembers,
  inboxes,
  lastEmailedForConversation,
  markNotificationsEmailed,
  planRecipients,
  pushNotifications,
  replyEmailAllowed,
  users,
  withinEmailCap,
  type DbClient,
  type MessageContext,
  type NotificationKind,
} from "@calder/db";
import { logger } from "@calder/observability";
import { sendCompanyEmailQuietly } from "./send.js";

/**
 * Deciding what a shared inbox should interrupt someone about, and doing it.
 *
 * Callers (ingest, the assignment action) hand over the event; this module
 * applies the policy from `@calder/db/notification-policy` and then, for the
 * people who should be emailed, sends through the company-email system — which
 * already owns consent, idempotency and provider-failure handling.
 *
 * Invariants worth stating, because each one is a way this goes wrong:
 *
 *  - **In-app first.** A row is written for every eligible person; the badge is
 *    the primary signal and it never depends on a mail provider being up.
 *  - **One email per conversation per person.** Notification rows are unique on
 *    (user, conversation, kind) and only newly inserted rows are considered for
 *    email, so a retried ingest cannot double-send.
 *  - **Never blocking.** Email attempts are quiet: failures are logged, not
 *    thrown. Receiving mail must never fail because a mail provider hiccuped.
 *  - **Capped.** At most `NOTIFICATION_EMAIL_HOURLY_CAP` emails per person per
 *    hour, and at most one reply email per conversation per hour.
 */

export interface InboxNotificationEvent {
  kind: NotificationKind;
  inboxId: string;
  conversationId: string | null;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  /** First ~140 characters of the body, for the email and the bell. */
  preview?: string | null;
  /** Required for inbound kinds: drives the loop-prevention rule. */
  message?: MessageContext | null;
  actorUserId?: string | null;
  assigneeUserId?: string | null;
  /** Display name of whoever assigned it. */
  assignedByName?: string | null;
}

export interface InboxNotificationResult {
  notified: number;
  emailed: number;
  /** Why nobody was notified, when nobody was. */
  reason?: string;
}

export interface InboxNotificationDeps {
  now?: () => Date;
  /** Injectable so tests never reach a provider. */
  send?: (params: Parameters<typeof sendCompanyEmailQuietly>[1]) => Promise<unknown>;
  /** Absolute base for links in email; empty means relative (in-app paths). */
  appUrl?: string;
}

const KIND_TO_TEMPLATE = {
  "inbox.new_conversation": "inbox.new_conversation",
  "inbox.assigned": "inbox.assigned",
  "inbox.reply_received": "inbox.reply_received",
} as const satisfies Record<NotificationKind, string>;

function conversationHref(conversationId: string | null): string {
  return conversationId ? `/inbox/${conversationId}` : "/inbox";
}

function excerpt(value: string | null | undefined, max = 140): string {
  if (!value) return "";
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function notifyInboxActivity(
  db: DbClient,
  event: InboxNotificationEvent,
  deps: InboxNotificationDeps = {}
): Promise<InboxNotificationResult> {
  const now = deps.now?.() ?? new Date();
  const appUrl = deps.appUrl ?? "";

  const [inbox] = await db
    .select({
      id: inboxes.id,
      name: inboxes.name,
      organizationId: inboxes.organizationId,
      projectId: inboxes.projectId,
    })
    .from(inboxes)
    .where(eq(inboxes.id, event.inboxId))
    .limit(1);
  if (!inbox) return { notified: 0, emailed: 0, reason: "inbox_missing" };

  const members = await db
    .select({ userId: inboxMembers.userId, notify: inboxMembers.notify })
    .from(inboxMembers)
    .where(eq(inboxMembers.inboxId, inbox.id));

  const plan = planRecipients({
    kind: event.kind,
    members,
    assigneeUserId: event.assigneeUserId ?? null,
    actorUserId: event.actorUserId ?? null,
    message: event.message ?? null,
  });

  if (plan.recipients.length === 0) {
    return { notified: 0, emailed: 0, reason: plan.reason ?? "no_recipients" };
  }

  const fromLabel = event.fromName ?? event.fromAddress ?? "Someone";
  const subjectLabel = event.subject ?? "(no subject)";
  const preview = excerpt(event.preview);
  const href = conversationHref(event.conversationId);

  const titles: Record<NotificationKind, string> = {
    "inbox.new_conversation": `New in ${inbox.name}: ${subjectLabel}`,
    "inbox.assigned": `${event.assignedByName ?? "Someone"} assigned you: ${subjectLabel}`,
    "inbox.reply_received": `Reply from ${fromLabel}: ${subjectLabel}`,
  };

  const inserted = await pushNotifications(
    db,
    plan.recipients.map((recipient) => ({
      id: `ntf_${randomUUID().replace(/-/g, "").slice(0, 22)}`,
      userId: recipient.userId,
      organizationId: inbox.organizationId,
      projectId: inbox.projectId,
      kind: event.kind,
      inboxId: inbox.id,
      conversationId: event.conversationId,
      title: titles[event.kind],
      body: preview || null,
      href,
    }))
  );

  if (inserted.length === 0) {
    // Everything already existed: a redelivery, or these people had already
    // been told about this conversation in this way.
    return { notified: 0, emailed: 0, reason: "already_notified" };
  }

  // Only people who asked for email get email. The in-app row stands regardless.
  const emailable = inserted.filter((row) =>
    plan.recipients.some((r) => r.userId === row.userId && r.email)
  );
  if (emailable.length === 0) return { notified: inserted.length, emailed: 0, reason: "muted" };

  const people = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(
      inArray(
        users.id,
        emailable.map((row) => row.userId)
      )
    );
  const byId = new Map(people.map((p) => [p.id, p]));

  const send = deps.send ?? ((params) => sendCompanyEmailQuietly(db, params));
  let emailed = 0;

  for (const row of emailable) {
    const person = byId.get(row.userId);
    if (!person?.email) continue;

    const since = new Date(now.getTime() - 60 * 60 * 1000);
    const alreadySent = await emailsSentSince(db, { userId: row.userId, since });
    if (!withinEmailCap(alreadySent)) {
      // Over the cap: keep the row, skip the interruption. Logged because a cap
      // hit is the signal that the notification rules need revisiting.
      logger.info(
        { userId: row.userId, kind: event.kind },
        "Inbox notification email skipped: hourly cap"
      );
      continue;
    }

    if (event.kind === "inbox.reply_received" && event.conversationId) {
      const last = await lastEmailedForConversation(db, {
        userId: row.userId,
        conversationId: event.conversationId,
      });
      if (!replyEmailAllowed(last, now)) continue;
    }

    const result = await send({
      id: KIND_TO_TEMPLATE[event.kind],
      to: person.email,
      userId: row.userId,
      organizationId: inbox.organizationId,
      // Event-shaped, not random: the same event replays to the same key.
      idempotencyKey: `${row.id}`,
      data: {
        inboxName: inbox.name,
        subject: subjectLabel,
        fromName: fromLabel,
        preview,
        assignedByName: event.assignedByName ?? "",
        conversationUrl: `${appUrl}${href}`,
        inboxUrl: `${appUrl}/inbox`,
      },
    });

    const status = (result as { status?: string } | null)?.status;
    if (status === "sent" || status === "queued") {
      await markNotificationsEmailed(db, [row.id], now);
      emailed += 1;
    }
  }

  return {
    notified: inserted.length,
    emailed,
    ...(emailed === 0 ? { reason: "not_emailed" } : {}),
  };
}
