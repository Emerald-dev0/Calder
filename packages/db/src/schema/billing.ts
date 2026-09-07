import { pgTable, text, timestamp, varchar, integer, jsonb, index } from "drizzle-orm/pg-core";
import { planTierEnum, subscriptionStatusEnum } from "./enums";
import { organizations } from "./organizations";

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

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
