import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  integer,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { contactImportStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { audiences } from "./audiences.js";

/** One rejected CSV row, kept for the downloadable error report. */
export interface ContactImportRowError {
  row: number;
  email?: string;
  error: string;
}

export interface ContactImportErrorReport {
  rows: ContactImportRowError[];
}

/**
 * One CSV import into an audience. Counters are written by the import worker;
 * they are a report, never the source of truth for who is in the audience.
 *
 * `consent_confirmed` is the attestation that the sender is allowed to mail
 * these addresses. The CHECK constraint makes importing without it impossible,
 * not merely discouraged: a job row with `consent_confirmed = false` cannot be
 * inserted at all.
 */
export const contactImportJobs = pgTable(
  "contact_import_jobs",
  {
    id: text("id").primaryKey(), // imp_...
    // CASCADE: an import job has no meaning outside its workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: same, scoped to the tenant project.
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // CASCADE: the import targets one audience; removing the audience removes
    // its import reports too.
    audienceId: text("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "cascade" }),
    // No FK on purpose: mirrors audit_logs.actor_user_id, which must survive
    // user deletion. The exporter is historical attribution, not a relation.
    createdBy: text("created_by"),
    status: contactImportStatusEnum("status").notNull().default("pending"),
    fileName: varchar("file_name", { length: 255 }),
    totalRows: integer("total_rows").notNull().default(0),
    validRows: integer("valid_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    invalidRows: integer("invalid_rows").notNull().default(0),
    // Rows that already existed as unsubscribed / bounced / complained. They
    // are counted and skipped, never silently resubscribed.
    skippedUnsubscribed: integer("skipped_unsubscribed").notNull().default(0),
    skippedBounced: integer("skipped_bounced").notNull().default(0),
    skippedComplained: integer("skipped_complained").notNull().default(0),
    roleAddressRows: integer("role_address_rows").notNull().default(0),
    // Defaults to false but can never be stored as false: the CHECK requires
    // an explicit `true` on insert. Deliberate friction.
    consentConfirmed: boolean("consent_confirmed").notNull().default(false),
    errorReport: jsonb("error_report").$type<ContactImportErrorReport>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contact_import_jobs_audience_idx").on(t.audienceId),
    index("contact_import_jobs_org_status_idx").on(t.organizationId, t.status),
    // Import without an explicit consent attestation is impossible.
    check("contact_import_jobs_consent_confirmed_check", sql`"consent_confirmed" = true`),
  ]
);

export const contactImportJobsRelations = relations(contactImportJobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [contactImportJobs.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [contactImportJobs.projectId],
    references: [projects.id],
  }),
  audience: one(audiences, {
    fields: [contactImportJobs.audienceId],
    references: [audiences.id],
  }),
}));

export type ContactImportJob = typeof contactImportJobs.$inferSelect;
export type NewContactImportJob = typeof contactImportJobs.$inferInsert;
