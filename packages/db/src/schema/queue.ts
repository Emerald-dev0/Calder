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
import { jobStatusEnum } from "./enums.js";
import { organizations } from "./organizations.js";

/**
 * Durable PostgreSQL job queue — the replacement for a permanently running
 * BullMQ/Redis consumer.
 *
 * The row, not a Redis key, is the source of truth. Claiming uses
 * `FOR UPDATE SKIP LOCKED` plus a lease (`locked_until`), so N short-lived
 * processors can run concurrently and a crashed processor's job becomes
 * claimable again when its lease expires. `available_at` doubles as the
 * scheduled/retry time.
 *
 * `jobs.account_id` is nullable because some jobs are platform-level (e.g.
 * maintenance); customer jobs always carry the organization.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    jobType: varchar("job_type", { length: 64 }).notNull(),
    accountId: text("account_id").references(() => organizations.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    /** Higher runs first within the same availability window. */
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    /** Earliest time this job may be claimed (retry backoff / scheduled run). */
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 128 }),
    lastError: text("last_error"),
    /** Producer-supplied key; unique per type so a retry cannot duplicate work. */
    idempotencyKey: varchar("idempotency_key", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.availableAt, t.priority),
    index("jobs_account_idx").on(t.accountId),
    index("jobs_locked_until_idx").on(t.lockedUntil),
    uniqueIndex("jobs_type_idempotency_unique").on(t.jobType, t.idempotencyKey),
  ]
);

export type Job = typeof jobs.$inferSelect;

/**
 * One row per processor invocation. The processor endpoint is short-lived and
 * stateless, so this table is the operator's only durable answer to "is the
 * scheduler actually running, and what did the last run do?". A failed run is
 * recorded here too; silence is itself a signal (see operational alerts).
 */
export const queueProcessorRuns = pgTable(
  "queue_processor_runs",
  {
    id: text("id").primaryKey(),
    workerId: varchar("worker_id", { length: 128 }).notNull(),
    /** `github-actions`, `vercel-cron`, `manual`, `test`. Untrusted hint only. */
    trigger: varchar("trigger", { length: 32 }).notNull().default("manual"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** running | completed | failed | partial */
    status: varchar("status", { length: 16 }).notNull().default("running"),
    claimed: integer("claimed").notNull().default(0),
    completed: integer("completed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    released: integer("released").notNull().default(0),
    reapedLeases: integer("reaped_leases").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    webhooksDelivered: integer("webhooks_delivered").notNull().default(0),
    webhooksRetried: integer("webhooks_retried").notNull().default(0),
    durationMs: integer("duration_ms"),
    error: text("error"),
  },
  (t) => [index("queue_processor_runs_started_idx").on(t.startedAt)]
);

export type QueueProcessorRun = typeof queueProcessorRuns.$inferSelect;
