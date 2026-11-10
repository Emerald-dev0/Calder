/**
 * Bounded queue processor.
 *
 * One invocation does a fixed amount of work and returns. There is no timer
 * and no long-lived consumer: the scheduler (or a traffic-triggered call) is
 * the clock. Everything here is safe to run concurrently with itself:
 *
 *  - `claimJobs` uses `FOR UPDATE SKIP LOCKED` and a lease per row.
 *  - expired leases are reaped before claiming, so a crashed invocation's work
 *    becomes eligible again.
 *  - webhook attempts have their own delivery lease, separate from the job.
 *  - the runtime budget is enforced between jobs; unstarted claims are
 *    released without consuming an attempt.
 */
import { and, eq, lte, or, sql } from "drizzle-orm";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  expireCredits,
  failJob,
  finishProcessorRun,
  reapExpiredLeases,
  recoverExpiredWebhookDeliveries,
  releaseClaim,
  repairMissingWebhookJobs,
  startProcessorRun,
  type DbClient,
  type Job,
} from "@calder/db";
import { emails } from "@calder/db";
import { projects } from "@calder/db";
import { jobs as jobsTable } from "@calder/db";
import { logger } from "@calder/observability";
import { drainPendingEmails } from "./drain.js";
import { deliverWebhookJob } from "./webhook-delivery.js";

export const PROCESSOR_JOB_TYPES = [
  "email.send",
  "webhook.deliver",
  "billing.maintenance",
] as const;
export const PROCESSOR_MAX_JOBS = 25;
export const PROCESSOR_CHUNK = 5;
export const PROCESSOR_RUNTIME_BUDGET_MS = 45_000;
export const PROCESSOR_LEASE_SECONDS = 120;

export interface ProcessorSummary {
  runId: string;
  trigger: string;
  status: "completed" | "failed" | "partial";
  reapedLeases: number;
  recoveredWebhookLeases: number;
  repairedWebhookJobs: number;
  repairedEmailJobs: number;
  claimed: number;
  completed: number;
  failed: number;
  released: number;
  emailsSent: number;
  webhooksDelivered: number;
  webhooksRetried: number;
  durationMs: number;
  budgetExhausted: boolean;
  errors: string[];
}

/**
 * Re-create wake-ups for queued email rows that have no live job. This is the
 * reconciliation step that makes "due work is discovered without new traffic"
 * true; it also repairs rows stranded by the old immediate-enqueue bug.
 */
export async function repairDueEmailJobs(db: DbClient, limit = 50): Promise<number> {
  const due = await db
    .select({ id: emails.id, projectId: emails.projectId, organizationId: projects.organizationId })
    .from(emails)
    .innerJoin(projects, eq(projects.id, emails.projectId))
    .where(
      and(
        eq(emails.status, "queued"),
        or(sql`${emails.scheduledFor} is null`, lte(emails.scheduledFor, new Date())),
        or(sql`${emails.nextAttemptAt} is null`, lte(emails.nextAttemptAt, new Date())),
        sql`not exists (
          select 1 from ${jobsTable}
           where ${jobsTable.jobType} = 'email.send'
             and ${jobsTable.status} in ('pending', 'processing')
             and ${jobsTable.payload}->>'emailId' = ${emails.id}
        )`
      )
    )
    .orderBy(emails.createdAt)
    .limit(Math.max(1, Math.min(limit, 200)));

  let repaired = 0;
  for (const row of due) {
    try {
      await enqueueJob(db, {
        type: "email.send",
        accountId: row.organizationId,
        payload: { emailId: row.id, projectId: row.projectId },
        // Minute bucket: at most one repair wake-up per email per minute even
        // with concurrent processors, and a completed repair job does not
        // permanently suppress the next one.
        idempotencyKey: `email:repair:${row.id}:${Math.floor(Date.now() / 60_000)}`,
      });
      repaired++;
    } catch {
      // Next run retries; the email row is still durable.
    }
  }
  return repaired;
}

async function executeJob(
  db: DbClient,
  workerId: string,
  job: Job
): Promise<{
  emailsSent: number;
  webhooksDelivered: number;
  webhooksRetried: number;
  retryDelayMs?: number;
}> {
  if (job.jobType === "email.send") {
    const result = await drainPendingEmails(db, { batch: 10 });
    return { emailsSent: result.sent, webhooksDelivered: 0, webhooksRetried: 0 };
  }
  if (job.jobType === "webhook.deliver") {
    const result = await deliverWebhookJob(db, { job, workerId });
    if (result.status === "retryable") {
      return {
        emailsSent: 0,
        webhooksDelivered: 0,
        webhooksRetried: 1,
        retryDelayMs: result.retryDelayMs ?? undefined,
      };
    }
    return {
      emailsSent: 0,
      webhooksDelivered: result.status === "delivered" ? 1 : 0,
      webhooksRetried: 0,
    };
  }
  if (job.jobType === "billing.maintenance") {
    await expireCredits(db);
  }
  return { emailsSent: 0, webhooksDelivered: 0, webhooksRetried: 0 };
}

export async function runQueueProcessor(
  db: DbClient,
  opts: {
    trigger: string;
    workerId?: string;
    maxJobs?: number;
    runtimeBudgetMs?: number;
    now?: () => number;
  }
): Promise<ProcessorSummary> {
  const clock = opts.now ?? Date.now;
  const startedAt = clock();
  const workerId = opts.workerId ?? `proc_${crypto.randomUUID().slice(0, 12)}`;
  const maxJobs = Math.max(1, Math.min(opts.maxJobs ?? PROCESSOR_MAX_JOBS, 100));
  const budget = Math.max(1_000, opts.runtimeBudgetMs ?? PROCESSOR_RUNTIME_BUDGET_MS);

  const runId = await startProcessorRun(db, { workerId, trigger: opts.trigger });

  const summary: ProcessorSummary = {
    runId,
    trigger: opts.trigger,
    status: "completed",
    reapedLeases: 0,
    recoveredWebhookLeases: 0,
    repairedWebhookJobs: 0,
    repairedEmailJobs: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    released: 0,
    emailsSent: 0,
    webhooksDelivered: 0,
    webhooksRetried: 0,
    durationMs: 0,
    budgetExhausted: false,
    errors: [],
  };

  try {
    summary.reapedLeases = await reapExpiredLeases(db);
    summary.recoveredWebhookLeases = await recoverExpiredWebhookDeliveries(db);
    // Bound the repair work so a large backlog cannot turn one invocation into
    // an unbounded scan; repeated runs converge.
    summary.repairedWebhookJobs = await repairMissingWebhookJobs(db, 25);
    summary.repairedEmailJobs = await repairDueEmailJobs(db, 50);

    let stop = false;
    while (!stop && summary.claimed < maxJobs) {
      if (clock() - startedAt >= budget) {
        summary.budgetExhausted = true;
        break;
      }
      const remaining = Math.min(PROCESSOR_CHUNK, maxJobs - summary.claimed);
      const claimed = await claimJobs(db, {
        workerId,
        limit: remaining,
        leaseSeconds: PROCESSOR_LEASE_SECONDS,
        types: PROCESSOR_JOB_TYPES,
      });
      if (claimed.length === 0) break;
      summary.claimed += claimed.length;

      for (let i = 0; i < claimed.length; i++) {
        const job = claimed[i]!;
        if (clock() - startedAt >= budget) {
          // Release what we have not started: not an attempt, immediately
          // eligible for the next processor.
          for (const unstarted of claimed.slice(i)) {
            if (await releaseClaim(db, { id: unstarted.id, workerId })) summary.released++;
          }
          summary.budgetExhausted = true;
          stop = true;
          break;
        }
        try {
          const result = await executeJob(db, workerId, job);
          summary.emailsSent += result.emailsSent;
          summary.webhooksDelivered += result.webhooksDelivered;
          summary.webhooksRetried += result.webhooksRetried;
          if (result.retryDelayMs !== undefined) {
            const retried = await failJob(db, {
              id: job.id,
              workerId,
              error: "webhook endpoint asked for a retry",
              retryable: true,
              retryDelayMs: result.retryDelayMs,
            });
            if (retried.status === "pending") summary.failed++;
            else summary.completed++;
          } else if (await completeJob(db, { id: job.id, workerId })) {
            summary.completed++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          summary.errors.push(`${job.jobType}: ${message}`);
          await failJob(db, { id: job.id, workerId, error: message, retryable: true });
          summary.failed++;
          logger.warn({ jobId: job.id, jobType: job.jobType }, "processor job failed");
        }
      }
    }
  } catch (err) {
    summary.status = "failed";
    summary.errors.push(err instanceof Error ? err.message : String(err));
  }

  summary.durationMs = clock() - startedAt;
  if (summary.status !== "failed") {
    summary.status = summary.errors.length > 0 ? "partial" : "completed";
  }
  await finishProcessorRun(db, runId, {
    status: summary.status,
    claimed: summary.claimed,
    completed: summary.completed,
    failed: summary.failed,
    released: summary.released,
    reapedLeases: summary.reapedLeases,
    emailsSent: summary.emailsSent,
    webhooksDelivered: summary.webhooksDelivered,
    webhooksRetried: summary.webhooksRetried,
    durationMs: summary.durationMs,
    error: summary.errors.length > 0 ? summary.errors.slice(0, 10).join("; ") : null,
  });

  logger.info(
    {
      runId,
      trigger: summary.trigger,
      status: summary.status,
      claimed: summary.claimed,
      completed: summary.completed,
      failed: summary.failed,
      emailsSent: summary.emailsSent,
      webhooksDelivered: summary.webhooksDelivered,
      durationMs: summary.durationMs,
    },
    "queue processor run finished"
  );
  return summary;
}
