import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { contactConsentSourceEnum, contactStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";

/**
 * A person a project may mail. One row per (project, lowercased email):
 * Dev and Live projects deliberately do not share contacts, so a test import
 * can never reach a real subscriber.
 *
 * Everything a later phase needs to prove consent lives here: source,
 * timestamp, a salted IP hash (never the raw address) and a free-text note.
 * Consent history itself is append-only in `unsubscribe_events` /
 * `resubscribe_events`; this row holds the current state only.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey(), // ct_...
    // CASCADE: contacts belong to exactly one workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: contacts belong to exactly one project (the tenant key).
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Always stored lowercase; the CHECK below makes that a database fact
    // rather than a convention the import path has to remember.
    email: varchar("email", { length: 320 }).notNull(),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    // Arbitrary per-contact attributes used by segments. Never required.
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    status: contactStatusEnum("status").notNull().default("subscribed"),
    // Provenance of consent. Set once at creation; a later resubscribe appends
    // an event instead of rewriting history.
    consentSource: contactConsentSourceEnum("consent_source").notNull(),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    // Salted hash only (hex sha256). Raw IPs are never persisted.
    consentIpHash: varchar("consent_ip_hash", { length: 64 }),
    consentNote: text("consent_note"),
    // Double opt-in: only the hash of the confirmation token is stored.
    confirmationTokenHash: varchar("confirmation_token_hash", { length: 255 }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One contact per lowercased address inside a project.
    uniqueIndex("contacts_project_email_unique").on(t.projectId, t.email),
    // Org-wide reporting and quota checks. Project-scoped lookups use the
    // unique index above.
    index("contacts_org_status_idx").on(t.organizationId, t.status),
    // Segment rules read arbitrary keys out of `properties`.
    index("contacts_properties_gin").using("gin", t.properties),
    // The import path lowercases before insert; this makes a missed case a
    // constraint violation instead of a duplicate contact.
    check("contacts_email_lowercase_check", sql`"email" = lower("email")`),
  ]
);

export const contactsRelations = relations(contacts, ({ one }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [contacts.projectId], references: [projects.id] }),
}));

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
