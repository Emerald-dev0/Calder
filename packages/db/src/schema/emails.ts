import { sql } from "drizzle-orm";
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
import { emailStatusEnum, emailEventTypeEnum, emailStreamEnum } from "./enums.js";
import { projects } from "./projects.js";
import { organizations } from "./organizations.js";
import { senderIdentities } from "./senders.js";
import { broadcasts } from "./broadcasts.js";
import { contacts } from "./contacts.js";

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
    // Marketing provenance. Set only when stream = 'marketing'; NULL for
    // transactional mail. SET NULL: pruning a broadcast must not delete the
    // delivery log it produced.
    broadcastId: text("broadcast_id").references(() => broadcasts.id, { onDelete: "set null" }),
    // Recipient contact for broadcast sends. SET NULL: the log outlives a
    // contact that is later removed.
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
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
    // Reputation lane this send belongs to. Defaults to transactional: bulk
    // and promotional traffic must opt in to `marketing` explicitly. Purely
    // an annotation — it never bypasses suppression, quotas, consent, or
    // sender verification.
    stream: emailStreamEnum("stream").notNull().default("transactional"),
    status: emailStatusEnum("status").notNull().default("created"),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    // Which API-key environment accepted this email (stamped at ingest, never
    // changed): "test" rows are isolated — mocked delivery, never metered.
    env: varchar("env", { length: 8 }).notNull().default("live"),
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
    // Reputation-lane reporting: per-stream volumes over time.
    index("emails_stream_created_idx").on(t.stream, t.createdAt),
    // Broadcast progress: "what has this broadcast sent so far".
    index("emails_broadcast_idx").on(t.broadcastId),
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
    // "When did SES last report back?" — asked by /ready for the whole fleet.
    // Delivery feedback is identified by event type alone (only the SES
    // ingress writes delivered/bounced/complained), so type + recency is the
    // whole predicate and the scan stops at the first row.
    index("email_events_type_created_idx").on(t.type, t.createdAt.desc()),
    // The same question narrowed to one project, for the senders page. Without
    // the project prefix the planner would walk every tenant's events.
    index("email_events_project_type_created_idx").on(t.projectId, t.type, t.createdAt.desc()),
  ]
);

/**
 * Canonical suppression reasons. The column stays `text` on purpose: the
 * public suppression API accepts a free-form reason, and the historical
 * `suppression_reason` pg enum is unused (it only ever had bounce, complaint,
 * unsubscribe, manual). Application code should write one of these values;
 * `text` keeps older rows and operator-entered reasons readable.
 *
 * `bounce` covers hard bounces (permanent failures) exactly as the SES
 * feedback loop has always recorded them; `soft_bounce_repeated` is the
 * escalation a repeated transient failure eventually produces.
 */
export const SUPPRESSION_REASONS = [
  "bounce",
  "complaint",
  "unsubscribe",
  "manual",
  "soft_bounce_repeated",
  "import",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const suppressions = pgTable(
  "suppressions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Denormalised workspace id so a bounce recorded by one project is
    // readable workspace-wide without a join. Backfilled and NOT NULL.
    //
    // The `default null` exists only so inserts may omit the column: migration
    // 0027 adds a BEFORE INSERT / UPDATE OF project_id trigger that derives it
    // from projects.organization_id, so every existing suppression writer
    // (SES feedback, unsubscribe route, dashboard action) keeps working
    // unchanged. The column is still NOT NULL in the database.
    organizationId: text("organization_id")
      .notNull()
      .default(sql`null`)
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    // Deliberately `text`: see SUPPRESSION_REASONS above.
    reason: text("reason").notNull(),
    // Which email produced this suppression, when one did. SET NULL: the
    // suppression outlives the delivery log it came from.
    sourceEmailId: text("source_email_id").references(() => emails.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("suppressions_project_email_idx").on(t.projectId, t.email),
    // Workspace-wide reads (Phase 3+). Not unique yet: the current send path
    // still keys on (project_id, email), and duplicate rows across projects
    // in one workspace are tolerated until they are consolidated.
    index("suppressions_org_email_idx").on(t.organizationId, t.email),
    // One suppression per recipient per project: the SNS suppression
    // automation upserts ON CONFLICT (project_id, email) DO NOTHING.
    uniqueIndex("suppressions_project_email_unique").on(t.projectId, t.email),
  ]
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
