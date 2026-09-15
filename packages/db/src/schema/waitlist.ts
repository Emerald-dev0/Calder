import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { waitlistStatusEnum } from "./enums.js";

/**
 * Early-access waitlist. Public signup, no tenant ownership by design
 * (there is no organization yet). Email unique: one seat per address.
 * referralCode is shown to the user; referredBy stores the code that
 * brought them here. Position is computed, never stored.
 *
 * Profile columns (source/country/tags/note) are Control Plane fields:
 * captured where available at signup, editable only from the Control Plane.
 * first_name is the only identity the public form collects.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    // The only name the public form collects; never required.
    firstName: varchar("first_name", { length: 255 }),
    // Acquisition source: website, x, linkedin, tiktok, referral, campaign…
    source: varchar("source", { length: 100 }),
    country: varchar("country", { length: 100 }),
    status: waitlistStatusEnum("status").notNull().default("waiting"),
    tags: jsonb("tags").$type<string[]>(),
    // Internal-only operator note. Never shown to the person.
    note: text("note"),
    referralCode: varchar("referral_code", { length: 16 }).notNull().unique(),
    referredBy: varchar("referred_by", { length: 16 }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("waitlist_created_at_idx").on(t.createdAt),
    index("waitlist_referred_by_idx").on(t.referredBy),
    index("waitlist_status_idx").on(t.status),
    index("waitlist_source_idx").on(t.source),
  ]
);

/** Dynamic waitlist confirmation template — single row (id=internal) editable from /admin. */
export const waitlistConfirmation = pgTable("waitlist_confirmation", {
  id: text("id").primaryKey(), // "internal"
  subject: varchar("subject", { length: 998 }).notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Working copy for the confirmation email editor. Single row (id=internal).
 * The materialized `waitlist_confirmation` row above stays the source the
 * API send path reads; the draft only becomes real when published (REQ-073).
 */
export const waitlistConfirmationDrafts = pgTable("waitlist_confirmation_drafts", {
  id: text("id").primaryKey(), // "internal"
  subject: varchar("subject", { length: 998 }).notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable published snapshots of the confirmation email. Every publish
 * inserts a new row; restore copies an old version into the draft (REQ-072).
 */
export const waitlistConfirmationVersions = pgTable(
  "waitlist_confirmation_versions",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull(),
    subject: varchar("subject", { length: 998 }).notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    publishedBy: varchar("published_by", { length: 320 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("waitlist_confirmation_versions_version_key").on(t.version)]
);

export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
export type WaitlistConfirmation = typeof waitlistConfirmation.$inferSelect;
