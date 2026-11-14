/**
 * Notification data layer.
 *
 * Reads and writes only. The decisions live in `notification-policy.ts` and the
 * side effects (email) live in `@calder/notify`, so this module stays reusable
 * from the API, the dashboard and tests without dragging a mailer along.
 */
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import { notifications } from "./schema/notifications.js";
import { inboxConversations, inboxMembers, inboxes } from "./schema/inboxes.js";

export interface NotificationRow {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  readAt: Date | null;
  createdAt: Date;
}

export interface NewNotification {
  id: string;
  userId: string;
  organizationId: string | null;
  projectId: string | null;
  kind: string;
  inboxId: string | null;
  conversationId: string | null;
  title: string;
  body?: string | null;
  href: string;
}

/**
 * Insert notifications, ignoring ones that already exist.
 *
 * Returns the rows that were actually inserted — which is exactly the set that
 * should be considered for email. A duplicate (same person, conversation and
 * kind) is silently dropped by the unique index, so a redelivered SNS
 * notification, a retried ingest or a double-clicked assignment cannot produce
 * a second notification or a second email.
 */
export async function pushNotifications(
  db: DbExecutor,
  rows: NewNotification[]
): Promise<NewNotification[]> {
  if (rows.length === 0) return [];
  const inserted = await db.insert(notifications).values(rows).onConflictDoNothing().returning({
    id: notifications.id,
    userId: notifications.userId,
    organizationId: notifications.organizationId,
    projectId: notifications.projectId,
    kind: notifications.kind,
    inboxId: notifications.inboxId,
    conversationId: notifications.conversationId,
    title: notifications.title,
    body: notifications.body,
    href: notifications.href,
  });
  return inserted;
}

export async function listNotifications(
  db: DbExecutor,
  input: { userId: string; limit?: number; unreadOnly?: boolean }
): Promise<NotificationRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 50);
  const conditions = [eq(notifications.userId, input.userId)];
  if (input.unreadOnly) conditions.push(isNull(notifications.readAt));
  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadNotificationCount(db: DbExecutor, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.value ?? 0);
}

/** Mark specific notifications read, or every unread one for this person. */
export async function markNotificationsRead(
  db: DbExecutor,
  input: { userId: string; ids?: string[]; at?: Date }
): Promise<number> {
  const conditions = [eq(notifications.userId, input.userId), isNull(notifications.readAt)];
  if (input.ids && input.ids.length > 0) conditions.push(inArray(notifications.id, input.ids));
  const updated = await db
    .update(notifications)
    .set({ readAt: input.at ?? new Date() })
    .where(and(...conditions))
    .returning({ id: notifications.id });
  return updated.length;
}

/**
 * Mark everything about one conversation read.
 *
 * Called when someone opens the conversation: opening a thread is reading its
 * notifications, and asking them to also click "mark read" would leave the
 * badge lying to them.
 */
export async function markConversationNotificationsRead(
  db: DbExecutor,
  input: { userId: string; conversationId: string; at?: Date }
): Promise<number> {
  const updated = await db
    .update(notifications)
    .set({ readAt: input.at ?? new Date() })
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.conversationId, input.conversationId),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return updated.length;
}

/** Record that an email about these notifications was accepted. */
export async function markNotificationsEmailed(
  db: DbExecutor,
  ids: string[],
  at: Date = new Date()
): Promise<void> {
  if (ids.length === 0) return;
  await db.update(notifications).set({ emailedAt: at }).where(inArray(notifications.id, ids));
}

/** Emails this person received in the last hour — the cap input. */
export async function emailsSentSince(
  db: DbExecutor,
  input: { userId: string; since: Date }
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        gte(notifications.emailedAt, input.since),
        sql`${notifications.emailedAt} is not null`
      )
    );
  return Number(row?.value ?? 0);
}

/** When this person was last emailed about this conversation (reply throttle). */
export async function lastEmailedForConversation(
  db: DbExecutor,
  input: { userId: string; conversationId: string }
): Promise<Date | null> {
  const [row] = await db
    .select({ emailedAt: notifications.emailedAt })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, input.userId),
        eq(notifications.conversationId, input.conversationId),
        sql`${notifications.emailedAt} is not null`
      )
    )
    .orderBy(desc(notifications.emailedAt))
    .limit(1);
  return row?.emailedAt ?? null;
}

export interface InboxUnread {
  inboxId: string;
  unread: number;
}

/**
 * Unread conversations per inbox for one person, plus a total.
 *
 * A conversation counts as unread when it has moved since this member last read
 * the inbox (`inbox_members.last_read_at`) and is not closed. Closed threads
 * cannot be "waiting for you", so they never inflate a badge.
 */
export async function unreadConversationCounts(
  db: DbExecutor,
  input: { userId: string; organizationId?: string }
): Promise<{ perInbox: InboxUnread[]; total: number }> {
  const membership = await db
    .select({
      inboxId: inboxMembers.inboxId,
      lastReadAt: inboxMembers.lastReadAt,
    })
    .from(inboxMembers)
    .innerJoin(inboxes, eq(inboxes.id, inboxMembers.inboxId))
    .where(
      and(
        eq(inboxMembers.userId, input.userId),
        input.organizationId ? eq(inboxes.organizationId, input.organizationId) : sql`true`
      )
    );

  if (membership.length === 0) return { perInbox: [], total: 0 };

  const rows = await db
    .select({
      inboxId: inboxConversations.inboxId,
      unread: count(),
    })
    .from(inboxConversations)
    .where(
      and(
        inArray(
          inboxConversations.inboxId,
          membership.map((m) => m.inboxId)
        ),
        sql`${inboxConversations.status} <> 'closed'`,
        sql`${inboxConversations.lastMessageAt} > coalesce(
          (select m.last_read_at from inbox_members m
            where m.inbox_id = ${inboxConversations.inboxId}
              and m.user_id = ${input.userId}),
          'epoch'::timestamptz
        )`
      )
    )
    .groupBy(inboxConversations.inboxId);

  const perInbox = rows.map((r) => ({ inboxId: r.inboxId, unread: Number(r.unread) }));
  return { perInbox, total: perInbox.reduce((sum, r) => sum + r.unread, 0) };
}
