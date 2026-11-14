import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { inboundMessageStatusEnum, receivingDomainStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { inboxConversations, inboxes } from "./inboxes.js";

/**
 * Inbound email (Stage 3).
 *
 * Receiving is deliberately modelled as its own resource tree rather than as
 * a flag on `domains`. A sending domain is an identity we sign mail with; a
 * receiving domain is an MX target that decides where a stranger's mail is
 * accepted. They are configured in different DNS records, they are bought
 * separately, and — critically — a customer's existing MX (Google Workspace,
 * Microsoft 365) must never be touched to receive with us. Keeping the rows
 * apart makes that impossible to do by accident.
 *
 * The chain is:
 *
 *   receiving_domains   one MX target per domain, owned by a project
 *     → inbound_messages   one row per received message, deduped by SES id
 *       → inbound_attachments   one row per stored part
 *
 * Quota counts `inbound_messages` under the `organization_id` denormalised
 * here, so the inbound meter never has to join through projects and — more
 * importantly — never touches the outbound ledger.
 */

export const receivingDomains = pgTable(
  "receiving_domains",
  {
    id: text("id").primaryKey(), // rcd_...
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: varchar("domain", { length: 255 }).notNull(),
    status: receivingDomainStatusEnum("status").notNull().default("pending"),
    /**
     * TXT proof: `_calder-inbound.<domain> = calder-inbound=<token>`. The
     * same challenge-token pattern as sending domains, with a different prefix
     * so the two records can coexist on one name.
     */
    verificationToken: varchar("verification_token", { length: 64 }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** DNS checks allowed per rolling window — the same budget sending domains use. */
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    verifyWindowStart: timestamp("verify_window_start", { withTimezone: true }),
    /** MX target we ask the customer to point at, and the priority we accept. */
    mxHost: varchar("mx_host", { length: 255 }).notNull(),
    mxPriority: integer("mx_priority").notNull().default(10),
    /**
     * What we saw in DNS on the last successful check. Recorded (not asserted)
     * so the dashboard can show "MX → inbound.calder.click · 10" rather than
     * claiming a state nobody verified.
     */
    observedMx: jsonb("observed_mx").$type<Array<{ exchange: string; priority: number }>>(),
    observedTxt: jsonb("observed_txt").$type<string[]>(),
    /**
     * SES receipt rule that delivers this domain to our SNS topic + bucket.
     * Recorded per domain because recipient-domain matching is what SES
     * evaluates; an operator (or later automation) creates it and records the
     * names here, then flips `provisionedAt` through the admin endpoint.
     */
    sesRuleSetName: varchar("ses_rule_set_name", { length: 128 }),
    sesRuleName: varchar("ses_rule_name", { length: 128 }),
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    provisionedBy: text("provisioned_by"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Global, not per project: MX for one domain can only point at one place,
    // so two projects claiming the same receiving domain would make routing
    // ambiguous. Cross-tenant claim is refused before this index is hit.
    uniqueIndex("receiving_domains_domain_unique").on(t.domain),
    index("receiving_domains_project_idx").on(t.projectId),
  ]
);

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: text("id").primaryKey(), // inb_...
    /** Denormalised for quota + listing without joining projects. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * SET NULL, not CASCADE: deleting a receiving domain must not delete the
     * mail it already delivered. `recipientDomain` keeps the trail readable.
     */
    receivingDomainId: text("receiving_domain_id").references(() => receivingDomains.id, {
      onDelete: "set null",
    }),
    recipientDomain: varchar("recipient_domain", { length: 255 }).notNull(),
    /**
     * SES's own id. Unique: SNS delivers at least once, and this is the claim
     * that makes redelivery a no-op instead of a second message.
     */
    sesMessageId: varchar("ses_message_id", { length: 255 }).notNull(),
    /** SNS envelope MessageId, kept for support ("which delivery was that?"). */
    snsMessageId: varchar("sns_message_id", { length: 255 }),
    /** RFC 5322 Message-ID, used later for threading. */
    messageIdHeader: text("message_id_header"),
    envelopeFrom: text("envelope_from"),
    envelopeRecipient: text("envelope_recipient"),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddresses: jsonb("to_addresses").$type<string[]>().notNull().default([]),
    ccAddresses: jsonb("cc_addresses").$type<string[]>().notNull().default([]),
    replyToAddresses: jsonb("reply_to_addresses").$type<string[]>().notNull().default([]),
    subject: text("subject"),
    /** Selected headers, not the whole set — full fidelity lives in the raw S3 object. */
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    /** True when a body exceeded the storage cap and only its prefix is in the row. */
    bodyTruncated: boolean("body_truncated").notNull().default(false),
    attachmentCount: integer("attachment_count").notNull().default(0),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Where the raw MIME lives. Null until stored; never a fake placeholder. */
    rawStorageKey: text("raw_storage_key"),
    rawStoredAt: timestamp("raw_stored_at", { withTimezone: true }),
    /**
     * Routing and threading (Stage 4). SET NULL again: removing an inbox or a
     * conversation must not delete mail that already arrived. An unassigned
     * message stays readable at project level, which is what makes "no rule
     * matched" a recoverable state instead of a black hole.
     */
    inboxId: text("inbox_id").references(() => inboxes.id, { onDelete: "set null" }),
    conversationId: text("conversation_id").references(() => inboxConversations.id, {
      onDelete: "set null",
    }),
    status: inboundMessageStatusEnum("status").notNull().default("received"),
    /** Why processing failed or why we refused to store, verbatim and user-safe. */
    failureReason: text("failure_reason"),
    processingAttempts: integer("processing_attempts").notNull().default(0),
    /** SES receipt verdicts, recorded as received. Never inferred by us. */
    spamVerdict: varchar("spam_verdict", { length: 24 }),
    virusVerdict: varchar("virus_verdict", { length: 24 }),
    spfVerdict: varchar("spf_verdict", { length: 24 }),
    dkimVerdict: varchar("dkim_verdict", { length: 24 }),
    dmarcVerdict: varchar("dmarc_verdict", { length: 24 }),
    /** When SES received it (from the notification), not when we processed it. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_messages_ses_id_unique").on(t.sesMessageId),
    index("inbound_messages_project_received_idx").on(t.projectId, t.receivedAt),
    index("inbound_messages_org_received_idx").on(t.organizationId, t.receivedAt),
    index("inbound_messages_recipient_idx").on(t.recipientDomain),
    index("inbound_messages_inbox_received_idx").on(t.inboxId, t.receivedAt),
    index("inbound_messages_conversation_idx").on(t.conversationId, t.receivedAt),
    // Thread lookup by RFC 5322 Message-ID, scoped to a project.
    index("inbound_messages_message_id_idx").on(t.projectId, t.messageIdHeader),
    // Search across subject, body and sender. `simple` (no stemming) on
    // purpose: mail is names, addresses and product words, and `english`
    // would fold "invoices" into "invoic" for no gain. Expression index, so
    // there is no extra column to keep in sync.
    index("inbound_messages_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.subject}, '') || ' ' || coalesce(${t.bodyText}, '') || ' ' || coalesce(${t.fromAddress}, ''))`
    ),
  ]
);

export const inboundAttachments = pgTable(
  "inbound_attachments",
  {
    id: text("id").primaryKey(), // att_...
    inboundMessageId: text("inbound_message_id")
      .notNull()
      .references(() => inboundMessages.id, { onDelete: "cascade" }),
    /** Position in the MIME tree, so two "invoice.pdf" parts stay distinct. */
    partIndex: integer("part_index").notNull().default(0),
    filename: text("filename"),
    contentType: varchar("content_type", { length: 255 }),
    sizeBytes: integer("size_bytes").notNull().default(0),
    /** Content-ID for inline images referenced from the HTML body. */
    contentId: text("content_id"),
    disposition: varchar("disposition", { length: 24 }),
    storageKey: text("storage_key"),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inbound_attachments_part_unique").on(t.inboundMessageId, t.partIndex),
    index("inbound_attachments_message_idx").on(t.inboundMessageId),
  ]
);

export type ReceivingDomain = typeof receivingDomains.$inferSelect;
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type InboundAttachment = typeof inboundAttachments.$inferSelect;
