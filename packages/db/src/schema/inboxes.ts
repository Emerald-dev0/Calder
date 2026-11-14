import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { conversationStatusEnum, inboxMemberRoleEnum, inboxStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { receivingDomains } from "./inbound.js";
import { senderIdentities } from "./senders.js";
import { users } from "./users.js";

/**
 * Shared inboxes (Stage 4).
 *
 * The separation the brief asks for, expressed in tables:
 *
 *   sender identity  = WHO a message is from. Owns a verified address and a
 *                      transport; exists for outbound mail and is metered as
 *                      outbound usage.
 *   inbox            = WHERE received mail is managed. Owns routing addresses on
 *                      receiving domains, a team, conversations and replies.
 *
 * They meet in exactly one place, `inboxes.defaultSenderId`: an inbox picks the
 * identity its replies are sent from, which is a choice about sending made by a
 * receiving feature — never a merge of the two concepts. An inbox without a
 * default sender can still receive and be read; it simply cannot reply until
 * someone chooses one.
 *
 * Permissions are mailbox-level and stored here (`inbox_members`), deliberately
 * not folded into `organization_members`: a colleague can be a member of the
 * organisation and have no access to support@, or be a viewer of support@ while
 * being an admin of the workspace. Organisation owners and admins are treated as
 * managers implicitly (see `inboxCapabilities`), so a workspace is never locked
 * out of its own inbox.
 */

export const inboxes = pgTable(
  "inboxes",
  {
    id: text("id").primaryKey(), // inbx_...
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** Stable handle used in URLs; unique inside the project. */
    slug: varchar("slug", { length: 80 }).notNull(),
    /** Where replies are sent from. Null = receiving only, replying disabled. */
    defaultSenderId: text("default_sender_id").references(() => senderIdentities.id, {
      onDelete: "set null",
    }),
    status: inboxStatusEnum("status").notNull().default("active"),
    /** Email address shown to the world in the From of a reply. */
    replyToAddress: varchar("reply_to_address", { length: 255 }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inboxes_project_slug_unique").on(t.projectId, t.slug),
    index("inboxes_project_idx").on(t.projectId),
    index("inboxes_org_idx").on(t.organizationId),
  ]
);

/**
 * Which addresses land in which inbox.
 *
 * `localPart = '*'` is the catch-all for a receiving domain. Uniqueness on
 * (receiving domain, local part) means one address can never fan out into two
 * inboxes — ambiguous routing would either duplicate a conversation or lose it,
 * and both are worse than refusing the second claim.
 */
export const inboxRoutes = pgTable(
  "inbox_routes",
  {
    id: text("id").primaryKey(), // irt_...
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    receivingDomainId: text("receiving_domain_id")
      .notNull()
      .references(() => receivingDomains.id, { onDelete: "cascade" }),
    localPart: varchar("local_part", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbox_routes_domain_local_unique").on(t.receivingDomainId, t.localPart),
    index("inbox_routes_inbox_idx").on(t.inboxId),
  ]
);

export const inboxMembers = pgTable(
  "inbox_members",
  {
    id: text("id").primaryKey(), // imb_...
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: inboxMemberRoleEnum("role").notNull().default("member"),
    /**
     * Whether activity in this inbox may email this person. In-app
     * notifications and the unread badge are unaffected: muting is "do not
     * interrupt me", not "hide the work from me".
     */
    notify: boolean("notify").notNull().default(true),
    /** Drives the unread badge; never trusted for authorisation. */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbox_members_inbox_user_unique").on(t.inboxId, t.userId),
    index("inbox_members_user_idx").on(t.userId),
  ]
);

export const inboxConversations = pgTable(
  "inbox_conversations",
  {
    id: text("id").primaryKey(), // cnv_...
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inboxId: text("inbox_id")
      .notNull()
      .references(() => inboxes.id, { onDelete: "cascade" }),
    subject: text("subject"),
    /**
     * Thread identity: sorted participants + subject with reply prefixes
     * stripped. Used when headers do not give us a thread, which is common for
     * mail from ticket systems that rewrite Message-ID.
     */
    threadKey: varchar("thread_key", { length: 64 }).notNull(),
    /** Every address that has taken part, lower-cased and de-duplicated. */
    participants: jsonb("participants").$type<string[]>().notNull().default([]),
    status: conversationStatusEnum("status").notNull().default("open"),
    assigneeUserId: text("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    firstMessageAt: timestamp("first_message_at", { withTimezone: true }).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(0),
    inboundCount: integer("inbound_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    /** Optimistic concurrency for assignment/status changes in the UI. */
    version: integer("version").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbox_conversations_inbox_last_idx").on(t.inboxId, t.lastMessageAt),
    index("inbox_conversations_project_last_idx").on(t.projectId, t.lastMessageAt),
    index("inbox_conversations_thread_idx").on(t.inboxId, t.threadKey),
    index("inbox_conversations_assignee_idx").on(t.assigneeUserId),
    // "My open conversations" is the default view of a shared inbox.
    index("inbox_conversations_open_idx")
      .on(t.inboxId, t.lastMessageAt)
      .where(sql`status <> 'closed'`),
  ]
);

/** Internal notes: never sent, never visible to the customer. */
export const inboxNotes = pgTable(
  "inbox_notes",
  {
    id: text("id").primaryKey(), // note_...
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inbox_notes_conversation_idx").on(t.conversationId, t.createdAt)]
);

/**
 * A reply is an outbound email plus a place in the conversation.
 *
 * `emailId` points at the real `emails` row, so a reply is delivered, retried,
 * metered and webhooked by the same machinery as every other send. This table
 * adds only the conversation link and who wrote it — there is no second send
 * path to keep in sync.
 */
export const inboxReplies = pgTable(
  "inbox_replies",
  {
    id: text("id").primaryKey(), // rpl_...
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    emailId: text("email_id").notNull(),
    senderId: text("sender_id").references(() => senderIdentities.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbox_replies_conversation_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("inbox_replies_email_unique").on(t.emailId),
  ]
);

export const inboxLabels = pgTable(
  "inbox_labels",
  {
    id: text("id").primaryKey(), // lbl_...
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    color: varchar("color", { length: 24 }).notNull().default("neutral"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inbox_labels_project_name_unique").on(t.projectId, t.name)]
);

export const inboxConversationLabels = pgTable(
  "inbox_conversation_labels",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => inboxConversations.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => inboxLabels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.labelId] })]
);

export type Inbox = typeof inboxes.$inferSelect;
export type InboxRoute = typeof inboxRoutes.$inferSelect;
export type InboxMember = typeof inboxMembers.$inferSelect;
export type InboxConversation = typeof inboxConversations.$inferSelect;
export type InboxNote = typeof inboxNotes.$inferSelect;
export type InboxReply = typeof inboxReplies.$inferSelect;
export type InboxLabel = typeof inboxLabels.$inferSelect;
