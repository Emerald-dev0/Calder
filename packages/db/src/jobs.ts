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
import { jobs, queueProcessorRuns, type Job } from "./schema/queue.js";

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

/**
 * Exponential backoff with jitter. Attempt 1 (first failure) waits ~30s;
 * the ceiling is one hour. Jitter prevents a batch of jobs that failed together
 * from retrying in lockstep and re-creating the same spike.
 */
export function retryDelayForAttempt(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; random?: () => number } = {}
): number {
  const base = opts.baseMs ?? 30_000;
  const cap = opts.capMs ?? 3_600_000;
  const exponent = Math.max(1, Math.min(attempt, 10)) - 1;
  const raw = Math.min(cap, base * 2 ** exponent);
  const jitter = 0.2;
  const factor = 1 - jitter + (opts.random ?? Math.random)() * jitter * 2;
  return Math.max(1_000, Math.round(raw * factor));
}

/** Keep a long-running job's lease alive so another processor cannot take it. */
export async function renewLease(
  db: DbClient,
  opts: { id: string; workerId: string; seconds?: number }
): Promise<boolean> {
  const seconds = Math.max(5, Math.min(opts.seconds ?? 120, 3600));
  const rows = await db
    .update(jobs)
    .set({
      lockedUntil: sql`now() + (${seconds} * interval '1 second')`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, opts.id),
        eq(jobs.status, JOB_STATUS.processing),
        eq(jobs.lockedBy, opts.workerId)
      )
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/**
 * Return a claimed but unstarted job to the queue without counting the claim as
 * an attempt. Used when the processor is about to hit its runtime budget: the
 * job must be eligible again immediately, not after the full lease window.
 */
export async function releaseClaim(
  db: DbClient,
  opts: { id: string; workerId: string }
): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({
      status: JOB_STATUS.pending,
      availableAt: sql`now()`,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, opts.id),
        eq(jobs.status, JOB_STATUS.processing),
        eq(jobs.lockedBy, opts.workerId)
      )
    )
    .returning({ id: jobs.id });
  return rows.length > 0;
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
  const delay = opts.retryDelayMs ?? retryDelayForAttempt(job.attempts);
  const availableAt = retryable ? new Date(Date.now() + Math.max(1_000, delay)) : null;
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
  /** Pending jobs whose available_at has passed and that nobody has claimed. */
  duePending: number;
  /** Pending jobs that have already failed at least once. */
  retrying: number;
  /** Processing jobs whose lease has expired (crash awaiting recovery). */
  expiredLeases: number;
  oldestPendingAgeSeconds: number | null;
  oldestDueAgeSeconds: number | null;
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
  const [aggregates] = await db
    .select({
      duePending: sql<number>`count(*) filter (where status = 'pending' and available_at <= now())`,
      retrying: sql<number>`count(*) filter (where status = 'pending' and attempts > 0)`,
      expiredLeases: sql<number>`count(*) filter (where status = 'processing' and locked_until < now())`,
      oldestDueAge: sql<
        number | null
      >`extract(epoch from (now() - min(available_at) filter (where status = 'pending' and available_at <= now())))`,
    })
    .from(jobs);
  return {
    pending: byStatus.pending ?? 0,
    processing: byStatus.processing ?? 0,
    completed: byStatus.completed ?? 0,
    failed: byStatus.failed ?? 0,
    deadLetter: byStatus.dead_letter ?? 0,
    duePending: Number(aggregates?.duePending ?? 0),
    retrying: Number(aggregates?.retrying ?? 0),
    expiredLeases: Number(aggregates?.expiredLeases ?? 0),
    oldestDueAgeSeconds:
      aggregates?.oldestDueAge === null || aggregates?.oldestDueAge === undefined
        ? null
        : Number(aggregates.oldestDueAge),
    oldestPendingAgeSeconds: oldest?.seconds == null ? null : Number(oldest.seconds),
  };
}

export interface ProcessorRunInput {
  workerId: string;
  trigger: string;
}

/** Start a durable processor-run record. Returns its id. */
export async function startProcessorRun(db: DbClient, input: ProcessorRunInput): Promise<string> {
  const id = `qpr_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(queueProcessorRuns).values({
    id,
    workerId: input.workerId,
    trigger: input.trigger.slice(0, 32),
    status: "running",
  });
  return id;
}

/** Finish a run. Failures are recorded, not thrown away. */
export async function finishProcessorRun(
  db: DbClient,
  id: string,
  result: {
    status: "completed" | "failed" | "partial";
    claimed: number;
    completed: number;
    failed: number;
    released: number;
    reapedLeases: number;
    emailsSent: number;
    webhooksDelivered: number;
    webhooksRetried: number;
    durationMs: number;
    error?: string | null;
  }
): Promise<void> {
  await db
    .update(queueProcessorRuns)
    .set({
      finishedAt: new Date(),
      status: result.status,
      claimed: result.claimed,
      completed: result.completed,
      failed: result.failed,
      released: result.released,
      reapedLeases: result.reapedLeases,
      emailsSent: result.emailsSent,
      webhooksDelivered: result.webhooksDelivered,
      webhooksRetried: result.webhooksRetried,
      durationMs: result.durationMs,
      error: result.error ? result.error.slice(0, 4000) : null,
    })
    .where(eq(queueProcessorRuns.id, id));
}

export interface ProcessorRunSummary {
  id: string;
  trigger: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  claimed: number;
  emailsSent: number;
  webhooksDelivered: number;
  failed: number;
  error: string | null;
}

export async function recentProcessorRuns(
  db: DbExecutor,
  limit = 20
): Promise<ProcessorRunSummary[]> {
  const rows = await db
    .select({
      id: queueProcessorRuns.id,
      trigger: queueProcessorRuns.trigger,
      status: queueProcessorRuns.status,
      startedAt: queueProcessorRuns.startedAt,
      finishedAt: queueProcessorRuns.finishedAt,
      claimed: queueProcessorRuns.claimed,
      emailsSent: queueProcessorRuns.emailsSent,
      webhooksDelivered: queueProcessorRuns.webhooksDelivered,
      failed: queueProcessorRuns.failed,
      error: queueProcessorRuns.error,
    })
    .from(queueProcessorRuns)
    .orderBy(sql`${queueProcessorRuns.startedAt} desc`)
    .limit(Math.max(1, Math.min(limit, 100)));
  return rows;
}

/** Last successful and failed run, for alerts and the status endpoint. */
export async function lastProcessorRuns(
  db: DbExecutor
): Promise<{ lastSuccess: ProcessorRunSummary | null; lastFailure: ProcessorRunSummary | null }> {
  const runs = await recentProcessorRuns(db, 50);
  return {
    lastSuccess: runs.find((r) => r.status === "completed") ?? null,
    lastFailure: runs.find((r) => r.status === "failed" || r.status === "partial") ?? null,
  };
}

export interface DeadLetterJob {
  id: string;
  jobType: string;
  accountId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listDeadLetterJobs(db: DbExecutor, limit = 50): Promise<DeadLetterJob[]> {
  return db
    .select({
      id: jobs.id,
      jobType: jobs.jobType,
      accountId: jobs.accountId,
      attempts: jobs.attempts,
      lastError: jobs.lastError,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, JOB_STATUS.deadLetter))
    .orderBy(sql`${jobs.updatedAt} desc`)
    .limit(Math.max(1, Math.min(limit, 200)));
}

/**
 * Operator action: put a dead-lettered job back in the queue. The original
 * error stays in logs; the row's `last_error` is cleared so the next failure is
 * attributable to the new run.
 */
export async function requeueDeadLetterJob(
  db: DbClient,
  id: string
): Promise<{ requeued: boolean; reason?: string }> {
  const rows = await db
    .update(jobs)
    .set({
      status: JOB_STATUS.pending,
      attempts: 0,
      availableAt: sql`now()`,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.status, JOB_STATUS.deadLetter)))
    .returning({ id: jobs.id });
  return rows.length > 0 ? { requeued: true } : { requeued: false, reason: "not_dead_letter" };
}
