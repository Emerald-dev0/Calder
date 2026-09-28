import { pgTable, text, timestamp, varchar, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { emails } from "./emails.js";
import { projects } from "./projects.js";

/**
 * Provider feedback events (SES bounce/complaint/delivery/open/click signals
 * arriving via SNS, see apps/api/src/routes/ses-events.ts).
 *
 * Every accepted SNS notification lands here FIRST, deduped on the SNS
 * MessageId (SNS redelivers on non-2xx, and SES may emit semantically
 * identical events). State application to `emails`/`suppressions` reads from
 * this ledger, so re-processing is idempotent and the raw payload survives
 * for forensics. Auth is the SNS RSA signature, never a Calder API key.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    // sns | (future: gmail history, managed)
    provider: varchar("provider", { length: 32 }).notNull().default("ses"),
    // SNS MessageId — the dedupe key.
    snsMessageId: varchar("sns_message_id", { length: 255 }).notNull().unique(),
    // SES mail.messageId — joins to emails.provider_message_id (nullable:
    // events for mail we don't recognise are still recorded).
    sesMessageId: varchar("ses_message_id", { length: 255 }),
    // delivery | bounce | complaint | open | click | reject | rendering_failure | send
    eventType: varchar("event_type", { length: 40 }).notNull(),
    // Resolved Calder email row + project when the message id matched
    // (set null on delete: the ledger outlives the row).
    emailId: text("email_id").references(() => emails.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    // Recipient the event is about (bounce/complaint carry their own lists).
    recipient: varchar("recipient", { length: 320 }),
    // Full parsed SNS Message payload (sanitized shape from SES, no raw SMTP bodies)
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    // True when the event carried no email row match we could apply.
    unmatched: boolean("unmatched").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("provider_events_ses_message_idx").on(t.sesMessageId),
    index("provider_events_email_idx").on(t.emailId),
    index("provider_events_created_idx").on(t.createdAt),
  ]
);

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type NewProviderEvent = typeof providerEvents.$inferInsert;
