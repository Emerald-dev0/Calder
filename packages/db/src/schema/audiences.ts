import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { audienceContactStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { contacts } from "./contacts.js";

/**
 * A named list of contacts inside one project. Tenancy is carried twice on
 * purpose: `project_id` is the tenant key every other table uses, while
 * `organization_id` lets quota and org-level reporting answer without a join.
 *
 * Archiving is the only "delete": broadcasts reference audiences with
 * ON DELETE RESTRICT, so a list that has ever been sent to is permanent.
 */
export const audiences = pgTable(
  "audiences",
  {
    id: text("id").primaryKey(), // aud_...
    // CASCADE: an audience has no meaning outside its workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: same, scoped to the tenant project.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // When true, new contacts enter as pending_confirmation until they click
    // the confirmation link; only then does their membership become subscribed.
    doubleOptIn: boolean("double_opt_in").notNull().default(false),
    // Null = live. Archived names stay on the row so history reads correctly.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live audience name per project. Archived rows are excluded, so a
    // name can be reused after the list it belonged to is archived.
    uniqueIndex("audiences_project_name_unique")
      .on(t.projectId, t.name)
      .where(sql`"archived_at" IS NULL`),
    index("audiences_project_idx").on(t.projectId),
  ]
);

/**
 * Contact membership in an audience. This is a child table: it inherits
 * tenancy from both parents and carries no tenant columns of its own.
 * Composite primary key = a contact can be in an audience exactly once.
 */
export const audienceContacts = pgTable(
  "audience_contacts",
  {
    // CASCADE: membership cannot outlive its audience.
    audienceId: text("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "cascade" }),
    // CASCADE: membership cannot outlive its contact.
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    status: audienceContactStatusEnum("status").notNull().default("subscribed"),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.audienceId, t.contactId] }),
    index("audience_contacts_audience_status_idx").on(t.audienceId, t.status),
    index("audience_contacts_contact_idx").on(t.contactId),
  ]
);

export const audiencesRelations = relations(audiences, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [audiences.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [audiences.projectId], references: [projects.id] }),
  audienceContacts: many(audienceContacts),
}));

export const audienceContactsRelations = relations(audienceContacts, ({ one }) => ({
  audience: one(audiences, {
    fields: [audienceContacts.audienceId],
    references: [audiences.id],
  }),
  contact: one(contacts, {
    fields: [audienceContacts.contactId],
    references: [contacts.id],
  }),
}));

export type Audience = typeof audiences.$inferSelect;
export type NewAudience = typeof audiences.$inferInsert;
export type AudienceContact = typeof audienceContacts.$inferSelect;
export type NewAudienceContact = typeof audienceContacts.$inferInsert;
