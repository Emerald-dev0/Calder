import { Hono } from "hono";
import type { Env } from "../app.js";
import { logger } from "@calder/observability";
import {
  getDb,
  claimJobs,
  completeJob,
  expireCredits,
  failJob,
  reapExpiredLeases,
} from "@calder/db";
import { drainPendingEmails } from "../lib/drain.js";

const jobs = new Hono<Env>();

/**
 * Dedicated processor secret. Deliberately NOT CRON_SECRET or ADMIN_API_KEY:
 * the scheduler credential should be rotatable and scoped to job execution.
 * In production an unset secret disables the endpoint (404-equivalent 503)
 * rather than falling back to a weaker credential.
 */
function authorized(header: string | undefined): boolean {
  const secret = process.env.QUEUE_PROCESSOR_SECRET ?? "";
  if (!secret) return false;
  return header === `Bearer ${secret}`;
}

/**
 * POST /v1/jobs/process
 *
 * One short-lived invocation: recover expired leases, claim a bounded batch,
 * execute, record outcomes, return. No long-running worker, no in-process
 * timer. Safe to trigger concurrently: SKIP LOCKED prevents double claiming
 * and the email drain has its own lease.
 */
jobs.post("/process", async (c) => {
  const secretConfigured = Boolean(process.env.QUEUE_PROCESSOR_SECRET);
  if (!secretConfigured) {
    return c.json(
      { error: { code: "processor_disabled", message: "QUEUE_PROCESSOR_SECRET is not set" } },
      503
    );
  }
  if (!authorized(c.req.header("authorization"))) {
    return c.json({ error: { code: "unauthorized", message: "Invalid processor secret" } }, 401);
  }
  const db = getDb();
  const workerId = `proc_${crypto.randomUUID().slice(0, 12)}`;
  const reaped = await reapExpiredLeases(db);
  const claimed = await claimJobs(db, {
    workerId,
    limit: 25,
    leaseSeconds: 120,
    // Only types with a real handler here. `webhook.deliver` rows are durable
    // and remain pending until a handler exists; claiming them without
    // delivering would silently consume the wake-up.
    types: ["email.send", "billing.maintenance"],
  });

  let completed = 0;
  let failed = 0;
  let drained = 0;
  for (const job of claimed) {
    try {
      if (job.jobType === "email.send") {
        const result = await drainPendingEmails(db, { batch: 25 });
        drained += result.sent;
      } else if (job.jobType === "billing.maintenance") {
        await expireCredits(db);
      }
      const ok = await completeJob(db, { id: job.id, workerId });
      if (ok) completed++;
    } catch (err) {
      failed++;
      await failJob(db, {
        id: job.id,
        workerId,
        error: err instanceof Error ? err.message : String(err),
        // Transient by default: the lease reaper and attempt cap bound the
        // damage, and dead-lettered work stays inspectable.
        retryable: true,
      });
      logger.warn({ jobId: job.id, jobType: job.jobType }, "job execution failed");
    }
  }

  return c.json({
    workerId,
    reapedLeases: reaped,
    claimed: claimed.length,
    completed,
    failed,
    emailsSent: drained,
  });
});

export default jobs;
