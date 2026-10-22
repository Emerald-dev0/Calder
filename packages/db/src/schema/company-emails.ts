import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, varchar, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { organizations } from "./organizations.js";

/**
 * Calder's own mail to its own users.
 *
 * Deliberately separate from `emails`, which records what *customers* send
 * through the product. Mixing them would corrupt every usage number, the
 * customer's message log and their quota, because a password reset is not a
 * send the customer pays for.
 *
 * One row per attempt, written before the provider call so a crash mid-send
 * leaves evidence, and updated afterwards. The idempotency key is unique: the
 * same event replayed (a retried webhook, a double-clicked button) collapses
 * onto the first row instead of sending twice.
 */
export const companyEmails = pgTable(
  "company_emails",
  {
    id: text("id").primaryKey(),
    toEmail: varchar("to_email", { length: 320 }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    /** Catalogue id, e.g. `billing.payment_failed`. */
    template: varchar("template", { length: 100 }).notNull(),
    /** Coarse family from the catalogue: account, billing, usage, … */
    category: varchar("category", { length: 32 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    /** queued | sent | failed | skipped */
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    /** Only set on skipped: opted_out | duplicate | invalid_recipient | no_provider */
    skipReason: varchar("skip_reason", { length: 64 }),
    provider: varchar("provider", { length: 32 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    /** Provider refusal text, already scrubbed of recipient/transport detail. */
    error: text("error"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    /** Template data that is safe to keep: ids, counts, plan names. Never tokens. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_emails_idempotency_unique").on(t.idempotencyKey),
    index("company_emails_to_idx").on(t.toEmail, t.createdAt),
    index("company_emails_user_idx").on(t.userId, t.createdAt),
    index("company_emails_template_idx").on(t.template, t.createdAt),
    index("company_emails_status_idx").on(t.status, t.createdAt),
  ]
);

/**
 * Per-user email preferences.
 *
 * Stores the categories a person has switched *off*. The mandatory categories
 * (account, security, billing, legal, usage, operations) are never written
 * here — `sendCompanyEmail` refuses to honour an opt-out for them, because
 * "stop telling me my payment failed" is not a preference we can offer.
 *
 * Absence of a row means "everything on", so the table only grows when someone
 * actually changes something.
 */
export const emailPreferences = pgTable(
  "email_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    disabledCategories: jsonb("disabled_categories")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
  // `user_id` is already `.unique()`, which creates the index this table needs.
);
