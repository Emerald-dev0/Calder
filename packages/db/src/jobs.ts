/**
 * PostgreSQL-backed durable job queue.
 *
 * This is the zero-fixed-cost replacement for a permanently running BullMQ
 * consumer. A job is a row; claiming is a single `UPDATE ... FROM (SELECT ...
 * FOR UPDATE SKIP LOCKED)` statement, so concurrent processors never take the
 * same row and a crashed processor's lease expires back into `pending`.
 *
 * Honest limits: a commit after the provider accepts an email but before the
 * result is recorded leaves an ambiguous outcome. Attempts, `last_error` and
 * the provider id on the email record make it visible; this module never
 * claims exactly-once delivery.
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import type { DbClient, DbExecutor } from "./client.js";
import { jobs, type Job } from "./schema/queue.js";

export const JOB_STATUS = {
  pending: "pending",
  processing: "processing",
  completed: "completed",
  failed: "failed",
  deadLetter: "dead_letter",
} as const;

export interface EnqueueJobInput {
  type: string;
  payload: Record<string, unknown>;
  accountId?: string | null;
  priority?: number;
  maxAttempts?: number;
  /** Delay before the job becomes claimable (scheduled work / backoff). */
  delayMs?: number;
  /** Unique per job type. A duplicate is a no-op and returns the existing id. */
  idempotencyKey?: string | null;
}

export interface EnqueuedJob {
  id: string;
  created: boolean;
}

export async function enqueueJob(db: DbClient, input: EnqueueJobInput): Promise<EnqueuedJob> {
  const id = `job_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const availableAt =
    input.delayMs && input.delayMs > 0 ? new Date(Date.now() + input.delayMs) : new Date();
  const rows = await db
    .insert(jobs)
    .values({
      id,
      jobType: input.type,
      accountId: input.accountId ?? null,
      payload: input.payload,
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 5,
      availableAt,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  if (rows[0]) return { id: rows[0].id, created: true };
  if (!input.idempotencyKey) {
    throw new Error(`Unable to enqueue job ${input.type}: insert returned no row`);
  }
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.jobType, input.type), eq(jobs.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (!existing) throw new Error(`Unable to resolve idempotent job ${input.type}`);
  return { id: existing.id, created: false };
}

export interface ClaimOptions {
  workerId: string;
  limit?: number;
  leaseSeconds?: number;
  /** Restrict to these job types (a processor only handles what it can run). */
  types?: readonly string[];
}

/**
 * Atomically claim up to `limit` eligible jobs. The selected rows are locked
 * with SKIP LOCKED, then flipped to `processing` with a lease and an
 * incremented attempt counter in the same statement/transaction.
 */
export async function claimJobs(db: DbClient, opts: ClaimOptions): Promise<Job[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 100));
  const lease = Math.max(5, Math.min(opts.leaseSeconds ?? 120, 3600));
  const typeFilter =
    opts.types && opts.types.length > 0
      ? sql`and job_type in (${sql.join(
          opts.types.map((t) => sql`${t}`),
          sql`, `
        )})`
      : sql``;

  const result = await db.execute<Job>(sql`
    with picked as (
      select id from jobs
      where status = 'pending'
        and available_at <= now()
        and (locked_until is null or locked_until < now())
        ${typeFilter}
      order by priority desc, available_at asc, created_at asc
      limit ${limit}
      for update skip locked
    )
    update jobs j
       set status = 'processing',
           locked_at = now(),
           locked_until = now() + (${lease} * interval '1 second'),
           locked_by = ${opts.workerId},
           attempts = j.attempts + 1,
           updated_at = now()
      from picked
     where j.id = picked.id
     returning j.*
  `);
  return normalizeClaimedRows(result);
}

interface RawJobRow {
  id: string;
  job_type: string;
  account_id: string | null;
  payload: Record<string, unknown>;
  status: Job["status"];
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_at: Date | null;
  locked_until: Date | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

/**
 * `db.execute` with raw SQL returns driver-shaped rows (snake_case) and the
 * exact envelope differs between drizzle releases, so both the `.rows` wrapper
 * and a bare array are handled explicitly instead of cast blindly.
 */
function normalizeClaimedRows(result: unknown): Job[] {
  const rows = Array.isArray(result)
    ? (result as RawJobRow[])
    : ((result as { rows?: RawJobRow[] }).rows ?? []);
  return rows.map((row) => ({
    id: row.id,
    jobType: row.job_type,
    accountId: row.account_id,
    payload: row.payload,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: new Date(row.available_at),
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  }));
}

export async function completeJob(
  db: DbClient,
  opts: { id: string; workerId: string }
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: JOB_STATUS.completed,
      completedAt: new Date(),
      updatedAt: new Date(),
      lockedUntil: null,
      lastError: null,
    })
    .where(and(eq(jobs.id, opts.id), eq(jobs.lockedBy, opts.workerId)))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Move an exhausted or permanently failed job out of the retry path. */
export async function deadLetterJob(
  db: DbClient,
  opts: { id: string; error: string; retryable: boolean }
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: opts.retryable ? JOB_STATUS.deadLetter : JOB_STATUS.failed,
      lastError: opts.error.slice(0, 4000),
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, opts.id));
}

/**
 * Record a failed attempt. Retryable work returns to `pending` at `availableAt`
 * (exponential backoff + jitter); a permanent failure or exhausted attempt
 * counter becomes `failed` / `dead_letter` and stays inspectable.
 */
export async function failJob(
  db: DbClient,
  opts: {
    id: string;
    workerId?: string;
    error: string;
    retryable: boolean;
    retryDelayMs?: number;
  }
): Promise<{ status: Job["status"]; attempts: number; availableAt: Date | null }> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, opts.id)).limit(1);
  if (!job) throw new Error(`Job ${opts.id} not found`);
  if (job.status === JOB_STATUS.completed) {
    return { status: job.status, attempts: job.attempts, availableAt: null };
  }
  const exhausted = job.attempts >= job.maxAttempts;
  const retryable = opts.retryable && !exhausted;
  const availableAt = retryable
    ? new Date(Date.now() + Math.max(1_000, opts.retryDelayMs ?? 5_000))
    : null;
  await db
    .update(jobs)
    .set({
      status: retryable
        ? JOB_STATUS.pending
        : opts.retryable
          ? JOB_STATUS.deadLetter
          : JOB_STATUS.failed,
      lastError: opts.error.slice(0, 4000),
      availableAt: availableAt ?? job.availableAt,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date(),
      ...(retryable ? {} : { completedAt: new Date() }),
    })
    .where(eq(jobs.id, opts.id));
  return {
    status: retryable
      ? JOB_STATUS.pending
      : opts.retryable
        ? JOB_STATUS.deadLetter
        : JOB_STATUS.failed,
    attempts: job.attempts,
    availableAt,
  };
}

/**
 * Recover jobs whose processor died: an expired lease returns the row to
 * `pending`. The attempt was already counted at claim time, so repeated crashes
 * eventually exhaust `max_attempts` instead of looping forever.
 */
export async function reapExpiredLeases(db: DbClient): Promise<number> {
  const result = await db.execute(sql`
    update jobs
       set status = 'pending',
           locked_at = null,
           locked_until = null,
           locked_by = null,
           last_error = coalesce(last_error, 'lease expired before completion'),
           updated_at = now()
     where status = 'processing'
       and locked_until is not null
       and locked_until < now()
     returning id
  `);
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows.length;
}

/** Operator action: return a dead-letter job to the queue once. */
export async function requeueDeadLetter(db: DbClient, id: string): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: JOB_STATUS.pending,
      availableAt: new Date(),
      attempts: 0,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, JOB_STATUS.deadLetter)))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export interface JobMetrics {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  oldestPendingAgeSeconds: number | null;
}

export async function jobMetrics(db: DbExecutor): Promise<JobMetrics> {
  const rows = await db
    .select({ status: jobs.status, value: count() })
    .from(jobs)
    .groupBy(jobs.status);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.value)]));
  const [oldest] = await db
    .select({ seconds: sql<number>`extract(epoch from (now() - min(${jobs.createdAt})))` })
    .from(jobs)
    .where(eq(jobs.status, JOB_STATUS.pending));
  return {
    pending: byStatus.pending ?? 0,
    processing: byStatus.processing ?? 0,
    completed: byStatus.completed ?? 0,
    failed: byStatus.failed ?? 0,
    deadLetter: byStatus.dead_letter ?? 0,
    oldestPendingAgeSeconds: oldest?.seconds == null ? null : Number(oldest.seconds),
  };
}
