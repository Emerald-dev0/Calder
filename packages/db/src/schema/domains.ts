import { pgTable, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { domainStatusEnum, domainVerificationMethodEnum } from "./enums";
import { projects } from "./projects";

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("domain_verifications_domain_idx").on(t.domainId)]
);

export type Domain = typeof domains.$inferSelect;
export type DomainVerification = typeof domainVerifications.$inferSelect;
