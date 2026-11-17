import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { users } from "./users.js";
import { inboxConversations, inboxes } from "./inboxes.js";

/**
 * In-app notifications.
 *
 * Deliberately generic (kind + title + href) rather than a table per feature:
 * the bell is one surface, and a second notification system would immediately
 * disagree with this one about what "unread" means.
 *
 * Deduplication is structural: `(user_id, conversation_id, kind)` is unique when
 * a conversation is involved, so a redelivered SNS notification, a retried
 * ingest, or a webhook replay cannot produce a second "new conversation" entry
 * for the same person. That uniqueness is also the coalescing rule — one row per
 * person per conversation per kind, forever.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(), // ntf_...
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** `inbox.new_conversation` | `inbox.assigned` | `inbox.reply_received`. */
    kind: varchar("kind", { length: 48 }).notNull(),
    inboxId: text("inbox_id").references(() => inboxes.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => inboxConversations.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    body: text("body"),
    /** Where clicking it should go. Always an in-app path. */
    href: text("href").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** When an email about this notification was accepted by the provider. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(sql`read_at is null`),
    uniqueIndex("notifications_user_conversation_kind_unique")
      .on(t.userId, t.conversationId, t.kind)
      .where(sql`conversation_id is not null`),
  ]
);

export type Notification = typeof notifications.$inferSelect;
