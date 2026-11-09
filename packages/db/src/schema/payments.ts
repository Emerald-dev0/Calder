import {
  pgTable,
  text,
  varchar,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { paymentKindEnum, paymentStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";

/**
 * One row per checkout attempt (subscription, credit pack or burst pass).
 * Created before redirecting to Paystack; fulfilled only by a verified
 * server-side webhook/verify call, never by the browser redirect.
 */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull().default("paystack"),
    /** Provider transaction reference; unique across our system. */
    reference: varchar("reference", { length: 255 }).notNull(),
    kind: paymentKindEnum("kind").notNull(),
    /** e.g. pack id, burst pass id, plan tier. */
    productId: varchar("product_id", { length: 64 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: paymentStatusEnum("status").notNull().default("pending"),
    providerTransactionId: varchar("provider_transaction_id", { length: 255 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payments_reference_unique").on(t.reference),
    index("payments_org_idx").on(t.organizationId, t.createdAt),
    index("payments_status_idx").on(t.status),
  ]
);

/**
 * Raw provider webhook receipts. The provider event id is the primary key for
 * dedupe; replaying a webhook can never fulfil a purchase twice.
 */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: text("id").primaryKey(), // `${provider}:${eventId}`
    provider: varchar("provider", { length: 32 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    reference: varchar("reference", { length: 255 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("payment_webhook_events_reference_idx").on(t.reference)]
);

export type Payment = typeof payments.$inferSelect;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
