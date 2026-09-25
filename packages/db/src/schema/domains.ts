import {
  pgTable,
  text,
  timestamp,
  varchar,
  index,
  uniqueIndex,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { domainStatusEnum, domainVerificationMethodEnum } from "./enums.js";
import { projects } from "./projects.js";

export const domains = pgTable(
  "domains",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull(),
    status: domainStatusEnum("status").notNull().default("pending"),
    verificationMethod: domainVerificationMethodEnum("verification_method").default("dns"),
    verificationToken: varchar("verification_token", { length: 255 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // M4.1 challenge bookkeeping (ADR-039).
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    verifyWindowStart: timestamp("verify_window_start", { withTimezone: true }),
    lastVerifyError: text("last_verify_error"),
    // M4.2 deliverability identity: SES linkage + DKIM record set.
    sesIdentityStatus: varchar("ses_identity_status", { length: 24 }).default("not_linked"),
    dkimRecords: jsonb("dkim_records").$type<{ name: string; type: string; value: string }[]>(),
    dkimStatus: varchar("dkim_status", { length: 24 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("domains_project_domain_unique").on(t.projectId, t.domain),
    index("domains_project_idx").on(t.projectId),
  ]
);

export const domainVerifications = pgTable(
  "domain_verifications",
  {
    id: text("id").primaryKey(),
    domainId: text("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "cascade" }),
    method: domainVerificationMethodEnum("method").notNull(),
    status: domainStatusEnum("status").notNull().default("pending"),
    // e.g., DNS TXT record expected value, or hosted verification proof
    proof: text("proof"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    // M4.1 challenge bookkeeping (ADR-039).
    verificationExpiresAt: timestamp("verification_expires_at", { withTimezone: true }),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    verifyWindowStart: timestamp("verify_window_start", { withTimezone: true }),
    lastVerifyError: text("last_verify_error"),
    // M4.2 deliverability identity: SES linkage + DKIM record set.
    sesIdentityStatus: varchar("ses_identity_status", { length: 24 }).default("not_linked"),
    dkimRecords: jsonb("dkim_records").$type<{ name: string; type: string; value: string }[]>(),
    dkimStatus: varchar("dkim_status", { length: 24 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("domain_verifications_domain_idx").on(t.domainId)]
);

export type Domain = typeof domains.$inferSelect;
export type DomainVerification = typeof domainVerifications.$inferSelect;
