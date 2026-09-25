import { pgTable, text, timestamp, varchar, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { planTierEnum, subscriptionStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  tier: planTierEnum("tier").notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planPrices = pgTable(
  "plan_prices",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    currency: varchar("currency", { length: 3 }).notNull(), // NGN, USD
    amountCents: integer("amount_cents").notNull(),
    interval: varchar("interval", { length: 20 }).notNull().default("month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plan_prices_plan_idx").on(t.planId)]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    // provider IDs (Bachs)
    providerSubscriptionId: varchar("provider_subscription_id", { length: 255 }),
    providerCustomerId: varchar("provider_customer_id", { length: 255 }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_org_idx").on(t.organizationId)]
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    // e.g., emails_sent, emails_delivered
    metric: varchar("metric", { length: 100 }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_org_period_idx").on(t.organizationId, t.periodStart)]
);

/**
 * Rolled-up usage per (org, metric, period) — written by the idempotent
 * aggregation cron (`/v1/cron/aggregate-usage`), never by send paths. The
 * per-email ledger in `usage_records` stays authoritative; these rows are a
 * performance projection and are upserted on this table's deterministic id.
 */
export const usageSummaries = pgTable(
  "usage_summaries",
  {
    id: text("id").primaryKey(), // ur_agg_<orgId>_<metric>_<periodStartISO>
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    metric: varchar("metric", { length: 100 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    quantity: integer("quantity").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_summaries_org_metric_period_unique").on(
      t.organizationId,
      t.metric,
      t.periodStart
    ),
  ]
);

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type UsageSummary = typeof usageSummaries.$inferSelect;
