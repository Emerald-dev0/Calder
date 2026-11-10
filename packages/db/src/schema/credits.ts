import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { creditTransactionTypeEnum } from "./enums.js";
import { organizations } from "./organizations.js";

/** One prepaid monthly-credit purchase. Balance is per purchase (FIFO expiry). */
export const creditPurchases = pgTable(
  "credit_purchases",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    packId: varchar("pack_id", { length: 32 }).notNull(),
    creditsPurchased: integer("credits_purchased").notNull(),
    creditsRemaining: integer("credits_remaining").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paymentProvider: varchar("payment_provider", { length: 32 }).notNull().default("paystack"),
    paymentReference: varchar("payment_reference", { length: 255 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_purchases_payment_ref_unique").on(t.paymentReference),
    index("credit_purchases_org_expiry_idx").on(t.organizationId, t.expiresAt),
  ]
);

/** Append-only audit trail for every credit movement. */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    purchaseId: text("purchase_id").references(() => creditPurchases.id, {
      onDelete: "set null",
    }),
    type: creditTransactionTypeEnum("type").notNull(),
    /** Signed: positive adds credits, negative consumes/releases. */
    amount: integer("amount").notNull(),
    /** Email id, payment reference, or expiry batch id. */
    referenceId: varchar("reference_id", { length: 255 }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_transactions_org_idx").on(t.organizationId, t.createdAt),
    // Lookup path for consumption/release by email. Idempotency is enforced in
    // `releaseCredits` inside the admission transaction, not by a unique index
    // (one email may legitimately consume from more than one purchase).
    index("credit_transactions_type_ref_idx").on(t.type, t.referenceId),
  ]
);

/** A purchased daily burst pass; valid only on its UTC day. */
export const dailyBurstPasses = pgTable(
  "daily_burst_passes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    utcDay: varchar("utc_day", { length: 10 }).notNull(),
    additionalCapacity: integer("additional_capacity").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paymentReference: varchar("payment_reference", { length: 255 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("daily_burst_passes_payment_ref_unique").on(t.paymentReference),
    index("daily_burst_passes_org_day_idx").on(t.organizationId, t.utcDay),
  ]
);

export type CreditPurchase = typeof creditPurchases.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type DailyBurstPass = typeof dailyBurstPasses.$inferSelect;
