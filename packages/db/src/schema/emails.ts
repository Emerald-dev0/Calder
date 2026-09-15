import {
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";
import { emailStatusEnum, emailEventTypeEnum } from "./enums.js";
import { projects } from "./projects.js";
import { senderIdentities } from "./senders.js";

export const emails = pgTable(
  "emails",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // idempotency key scoped to project
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    from: varchar("from", { length: 320 }).notNull(),
    // Resolved sender identity (nullable = legacy bare-address send).
    // Delivery records must carry the identity, not just the string.
    senderIdentityId: text("sender_identity_id").references(() => senderIdentities.id, {
      onDelete: "set null",
    }),
    fromName: varchar("from_name", { length: 255 }),
    to: varchar("to", { length: 320 }).notNull(),
    cc: varchar("cc", { length: 1024 }),
    bcc: varchar("bcc", { length: 1024 }),
    replyTo: varchar("reply_to", { length: 320 }),
    subject: varchar("subject", { length: 998 }).notNull(),
    html: text("html"),
    text: text("text"),
    // structured metadata: template, tags, etc
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // attachments: [{ filename, contentType, contentBase64 }], ≤10 files, ≤25MB base64 total
    attachments: jsonb("attachments").$type<Array<{
      filename: string;
      contentType?: string;
      contentBase64: string;
    }> | null>(),
    // hold delivery until this time (scheduled sends ride delayed queue jobs)
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    status: emailStatusEnum("status").notNull().default("created"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    // What actually moved the message (set by the worker on send).
    transport: varchar("transport", { length: 32 }),
    provider: varchar("provider", { length: 32 }),
    // error details if failed
    lastError: text("last_error"),
    // retry tracking
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("emails_project_idx").on(t.projectId),
    index("emails_status_idx").on(t.status),
    index("emails_created_at_idx").on(t.createdAt),
    uniqueIndex("emails_project_idempotency_unique").on(t.projectId, t.idempotencyKey),
  ]
);

export const emailEvents = pgTable(
  "email_events",
  {
    id: text("id").primaryKey(),
    emailId: text("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: emailEventTypeEnum("type").notNull(),
    // provider response payload (sanitized)
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_events_email_idx").on(t.emailId),
    index("email_events_project_idx").on(t.projectId),
  ]
);

export const suppressions = pgTable(
  "suppressions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("suppressions_project_email_idx").on(t.projectId, t.email)]
);

// Idempotency keys, durable, not in-memory
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    // stored response for replay
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // expire after 24h typically
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("idempotency_project_key_unique").on(t.projectId, t.key)]
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    codeHash: varchar("code_hash", { length: 255 }).notNull(),
    purpose: varchar("purpose", { length: 50 }).notNull().default("verification"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otp_project_email_idx").on(t.projectId, t.email)]
);

export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type EmailEvent = typeof emailEvents.$inferSelect;
export type Suppression = typeof suppressions.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
