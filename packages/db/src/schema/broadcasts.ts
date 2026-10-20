import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  broadcastRecipientStatusEnum,
  broadcastSkipReasonEnum,
  broadcastStatusEnum,
} from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { senderIdentities } from "./senders.js";
import { templates } from "./system.js";
import { audiences } from "./audiences.js";
import { segments } from "./segments.js";
import { contacts } from "./contacts.js";
import { emails } from "./emails.js";

/**
 * One scheduled or sent marketing message. A broadcast is the product word;
 * at the delivery layer it is an `emails` row with `stream = 'marketing'`.
 *
 * A broadcast always has a sender (NOT NULL, RESTRICT) and an audience
 * (NOT NULL, RESTRICT): neither the From identity nor the list that was
 * targeted can disappear from under a message that may already be sending.
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: text("id").primaryKey(), // bc_...
    // CASCADE: a broadcast has no meaning outside its workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: same, scoped to the tenant project.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    status: broadcastStatusEnum("status").notNull().default("draft"),
    // RESTRICT: a broadcast must always resolve to a real sender. Deleting the
    // sender would orphan the From identity on a message that may be in flight.
    senderId: text("sender_id")
      .notNull()
      .references(() => senderIdentities.id, { onDelete: "restrict" }),
    // Overrides the sender's default reply-to for this broadcast only.
    replyTo: varchar("reply_to", { length: 320 }),
    subject: varchar("subject", { length: 998 }).notNull(),
    previewText: varchar("preview_text", { length: 255 }),
    // SET NULL: deleting a template must not delete a broadcast. The rendered
    // html/text below is the durable snapshot of what was actually sent.
    templateId: text("template_id").references(() => templates.id, { onDelete: "set null" }),
    html: text("html"),
    text: text("text"),
    // RESTRICT: broadcasts are the record of who was targeted. A list that has
    // been sent to is archived, never deleted out from under its history.
    audienceId: text("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "restrict" }),
    // SET NULL: a segment is a filter, not history. Removing it must not
    // remove the broadcast that used it.
    segmentId: text("segment_id").references(() => segments.id, { onDelete: "set null" }),
    trackingOpens: boolean("tracking_opens").notNull().default(true),
    trackingClicks: boolean("tracking_clicks").notNull().default(true),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    // IANA zone the schedule was expressed in ("Africa/Lagos").
    timezone: varchar("timezone", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    pausedReason: text("paused_reason"),
    // Frozen at send time; NULL until the recipient list is materialised.
    recipientCount: integer("recipient_count"),
    // No FK on purpose: mirrors audit_logs.actor_user_id, which must survive
    // user deletion. Attribution is historical, not a relation.
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Workspace broadcast list, newest first.
    index("broadcasts_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    // "What is this sender doing right now" and the sender-delete guard.
    index("broadcasts_sender_status_idx").on(t.senderId, t.status),
    // Scheduler scan: due broadcasts in a given state.
    index("broadcasts_status_scheduled_idx").on(t.status, t.scheduledAt),
  ]
);

/**
 * The materialised recipient list for one broadcast. Written once when the
 * broadcast is queued, then advanced row by row by the worker.
 *
 * `(broadcast_id, contact_id)` is unique: re-running the materialisation is
 * idempotent, and a contact can never receive the same broadcast twice.
 */
export const broadcastRecipients = pgTable(
  "broadcast_recipients",
  {
    id: text("id").primaryKey(), // bcr_...
    // CASCADE: recipient rows belong to the broadcast and go with it.
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    // RESTRICT: delivery history must survive. Contacts are anonymised or
    // unsubscribed in place; a hard delete would erase what was sent to whom.
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    // SET NULL: the email log can be pruned by retention without losing the
    // per-recipient bookkeeping that says this person was mailed.
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    status: broadcastRecipientStatusEnum("status").notNull().default("pending"),
    skipReason: broadcastSkipReasonEnum("skip_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Send idempotency: one row per (broadcast, contact).
    uniqueIndex("broadcast_recipients_broadcast_contact_unique").on(t.broadcastId, t.contactId),
    index("broadcast_recipients_broadcast_status_idx").on(t.broadcastId, t.status),
    index("broadcast_recipients_contact_idx").on(t.contactId),
  ]
);

/**
 * A link rewritten for click tracking. `short_token` is what appears in the
 * URL; `original_url` is where the click is sent.
 */
export const broadcastLinks = pgTable(
  "broadcast_links",
  {
    id: text("id").primaryKey(), // bcl_...
    // CASCADE: links belong to one broadcast; deleting a draft takes them too.
    broadcastId: text("broadcast_id")
      .notNull()
      .references(() => broadcasts.id, { onDelete: "cascade" }),
    originalUrl: text("original_url").notNull(),
    shortToken: varchar("short_token", { length: 64 }).notNull(),
    clickCount: integer("click_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("broadcast_links_short_token_unique").on(t.shortToken),
    index("broadcast_links_broadcast_idx").on(t.broadcastId),
  ]
);

/**
 * One click on one tracked link. Privacy: the IP and user agent are stored as
 * salted hashes only, never raw. Both foreign keys are optional because a
 * click can arrive without a resolvable email (forwarded link, expired row).
 */
export const linkClicks = pgTable(
  "link_clicks",
  {
    id: text("id").primaryKey(), // clk_...
    // CASCADE: a click has no meaning without the link that recorded it.
    broadcastLinkId: text("broadcast_link_id")
      .notNull()
      .references(() => broadcastLinks.id, { onDelete: "cascade" }),
    // SET NULL: click analytics outlive the email log.
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    // SET NULL: clicks stay as aggregate engagement after a contact is removed.
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
    userAgentHash: varchar("user_agent_hash", { length: 64 }),
    ipHash: varchar("ip_hash", { length: 64 }),
  },
  (t) => [index("link_clicks_link_clicked_idx").on(t.broadcastLinkId, t.clickedAt)]
);

export const broadcastsRelations = relations(broadcasts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [broadcasts.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [broadcasts.projectId], references: [projects.id] }),
  sender: one(senderIdentities, {
    fields: [broadcasts.senderId],
    references: [senderIdentities.id],
  }),
  template: one(templates, { fields: [broadcasts.templateId], references: [templates.id] }),
  audience: one(audiences, { fields: [broadcasts.audienceId], references: [audiences.id] }),
  segment: one(segments, { fields: [broadcasts.segmentId], references: [segments.id] }),
  recipients: many(broadcastRecipients),
  links: many(broadcastLinks),
}));

// The `email` relation is deliberately absent: emails.ts imports broadcasts.ts
// for `emails.broadcast_id`, so declaring the inverse here would make the module
// graph cyclic for `relations()` (which is evaluated eagerly, unlike the FK
// callbacks).
export const broadcastRecipientsRelations = relations(broadcastRecipients, ({ one }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastRecipients.broadcastId],
    references: [broadcasts.id],
  }),
  contact: one(contacts, {
    fields: [broadcastRecipients.contactId],
    references: [contacts.id],
  }),
}));

export const broadcastLinksRelations = relations(broadcastLinks, ({ one, many }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastLinks.broadcastId],
    references: [broadcasts.id],
  }),
  clicks: many(linkClicks),
}));

export const linkClicksRelations = relations(linkClicks, ({ one }) => ({
  link: one(broadcastLinks, {
    fields: [linkClicks.broadcastLinkId],
    references: [broadcastLinks.id],
  }),
  contact: one(contacts, { fields: [linkClicks.contactId], references: [contacts.id] }),
}));

export type Broadcast = typeof broadcasts.$inferSelect;
export type NewBroadcast = typeof broadcasts.$inferInsert;
export type BroadcastRecipient = typeof broadcastRecipients.$inferSelect;
export type NewBroadcastRecipient = typeof broadcastRecipients.$inferInsert;
export type BroadcastLink = typeof broadcastLinks.$inferSelect;
export type NewBroadcastLink = typeof broadcastLinks.$inferInsert;
export type LinkClick = typeof linkClicks.$inferSelect;
export type NewLinkClick = typeof linkClicks.$inferInsert;
