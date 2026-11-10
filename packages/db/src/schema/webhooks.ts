import {
  pgTable,
  text,
  timestamp,
  varchar,
  jsonb,
  index,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { webhookEventEnum, webhookDeliveryStatusEnum } from "./enums.js";
import { projects } from "./projects.js";

export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 2048 }).notNull(),
    secret: varchar("secret", { length: 255 }).notNull(), // hashed or encrypted at rest
    events: jsonb("events").$type<string[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_project_idx").on(t.projectId)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    event: webhookEventEnum("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Whole-attempt wall time in ms (last attempt). */
    latencyMs: integer("latency_ms"),
    /** HTTP status of the endpoint's last response, when one arrived. */
    responseStatus: integer("response_status"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /**
     * Lease owned by the processor currently attempting delivery. A crash
     * leaves `sending` behind; `recoverExpiredWebhookDeliveries` returns it to
     * pending after the lease, so the event is not stranded.
     */
    lockedBy: varchar("locked_by", { length: 128 }),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhookId),
    index("webhook_deliveries_project_idx").on(t.projectId),
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
  ]
);

/**
 * One row per HTTP attempt. The delivery row keeps the current state; this
 * append-only table keeps the history, so a retry does not erase what happened
 * before it and an operator can see every response code without log access.
 *
 * The webhook event id is the `webhook_deliveries.id`, stable across every
 * attempt. This table's id identifies an attempt, never the event.
 */
export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    /** delivered | retryable | permanent */
    outcome: varchar("outcome", { length: 16 }).notNull(),
    responseStatus: integer("response_status"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_delivery_attempts_delivery_idx").on(t.deliveryId, t.createdAt),
    index("webhook_delivery_attempts_project_idx").on(t.projectId),
  ]
);

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDeliveryAttempt = typeof webhookDeliveryAttempts.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
