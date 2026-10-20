import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { resubscribeSourceEnum, unsubscribeScopeEnum, unsubscribeSourceEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { contacts } from "./contacts.js";
import { audiences } from "./audiences.js";
import { broadcasts } from "./broadcasts.js";
import { emails } from "./emails.js";

/**
 * Immutable unsubscribe record. Append-only by design: there is no
 * `updated_at`, and the application layer never issues UPDATE or DELETE
 * against this table. Correcting a mistake means appending the opposite
 * event, so the consent history stays auditable.
 *
 * `scope = 'audience'` leaves one list; `scope = 'workspace'` means no
 * marketing mail from this project at all. Neither blocks transactional mail.
 */
export const unsubscribeEvents = pgTable(
  "unsubscribe_events",
  {
    id: text("id").primaryKey(), // unsub_...
    // CASCADE: consent history has no meaning outside its workspace and is
    // removed with it (workspace deletion is the documented exception).
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: same, scoped to the tenant project.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // RESTRICT: a contact with consent history cannot be hard-deleted. The
    // event is evidence, and evidence does not cascade away.
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    // SET NULL: history must survive archiving or deleting the audience.
    audienceId: text("audience_id").references(() => audiences.id, { onDelete: "set null" }),
    // SET NULL: history must survive deleting the broadcast.
    broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    // SET NULL: history must survive email-log retention.
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    source: unsubscribeSourceEnum("source").notNull(),
    scope: unsubscribeScopeEnum("scope").notNull(),
    reason: text("reason"),
    // Salted hash only. The raw IP is never stored for clicks or unsubscribes.
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("unsubscribe_events_org_contact_idx").on(t.organizationId, t.contactId),
    index("unsubscribe_events_broadcast_idx").on(t.broadcastId),
  ]
);

/**
 * Immutable resubscribe record, the counterpart to `unsubscribe_events`.
 * Append-only for the same reason: consent is a history, not a flag.
 * A row here is the only thing that may move a contact back to subscribed.
 */
export const resubscribeEvents = pgTable(
  "resubscribe_events",
  {
    id: text("id").primaryKey(), // resub_...
    // CASCADE: consent history has no meaning outside its workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: same, scoped to the tenant project.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // RESTRICT: evidence does not cascade away with a contact.
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    // SET NULL: history must survive archiving the audience.
    audienceId: text("audience_id").references(() => audiences.id, { onDelete: "set null" }),
    // SET NULL: history must survive deleting the broadcast.
    broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    // SET NULL: history must survive email-log retention.
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    source: resubscribeSourceEnum("source").notNull(),
    scope: unsubscribeScopeEnum("scope").notNull(),
    reason: text("reason"),
    // Salted hash only.
    ipHash: varchar("ip_hash", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("resubscribe_events_org_contact_idx").on(t.organizationId, t.contactId),
    index("resubscribe_events_broadcast_idx").on(t.broadcastId),
  ]
);

export const unsubscribeEventsRelations = relations(unsubscribeEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [unsubscribeEvents.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [unsubscribeEvents.projectId],
    references: [projects.id],
  }),
  contact: one(contacts, {
    fields: [unsubscribeEvents.contactId],
    references: [contacts.id],
  }),
  audience: one(audiences, {
    fields: [unsubscribeEvents.audienceId],
    references: [audiences.id],
  }),
  broadcast: one(broadcasts, {
    fields: [unsubscribeEvents.broadcastId],
    references: [broadcasts.id],
  }),
}));

export const resubscribeEventsRelations = relations(resubscribeEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [resubscribeEvents.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [resubscribeEvents.projectId],
    references: [projects.id],
  }),
  contact: one(contacts, {
    fields: [resubscribeEvents.contactId],
    references: [contacts.id],
  }),
  audience: one(audiences, {
    fields: [resubscribeEvents.audienceId],
    references: [audiences.id],
  }),
  broadcast: one(broadcasts, {
    fields: [resubscribeEvents.broadcastId],
    references: [broadcasts.id],
  }),
}));

export type UnsubscribeEvent = typeof unsubscribeEvents.$inferSelect;
export type NewUnsubscribeEvent = typeof unsubscribeEvents.$inferInsert;
export type ResubscribeEvent = typeof resubscribeEvents.$inferSelect;
export type NewResubscribeEvent = typeof resubscribeEvents.$inferInsert;
