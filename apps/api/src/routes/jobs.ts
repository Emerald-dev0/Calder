import { Hono } from "hono";
import type { Env } from "../app.js";
import {
  getDb,
  jobMetrics,
  lastProcessorRuns,
  listDeadLetterJobs,
  listFailedWebhookDeliveries,
  recentProcessorRuns,
  requeueDeadLetterJob,
  reprocessWebhookDelivery,
  webhookQueueMetrics,
} from "@calder/db";
import { runQueueProcessor } from "../lib/processor.js";

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

function disabled(c: { json: (body: unknown, status: 503) => Response }) {
  return c.json(
    { error: { code: "processor_disabled", message: "QUEUE_PROCESSOR_SECRET is not set" } },
    503
  );
}

function unauthorized(c: { json: (body: unknown, status: 401) => Response }) {
  return c.json({ error: { code: "unauthorized", message: "Invalid processor secret" } }, 401);
}

/**
 * POST /v1/jobs/process
 *
 * One short-lived invocation: recover expired leases, repair missing
 * wake-ups, claim a bounded batch, execute, record outcomes, return.
 *
 * Safe to trigger concurrently. `x-calder-trigger` is recorded only as a
 * coarse label (`scheduler`, `manual`, `cron`) — never as free text, so a
 * caller cannot forge misleading history.
 */
jobs.post("/process", async (c) => {
  if (!process.env.QUEUE_PROCESSOR_SECRET) return disabled(c);
  if (!authorized(c.req.header("authorization"))) return unauthorized(c);

  const requested = c.req.header("x-calder-trigger");
  const trigger =
    requested === "scheduler" || requested === "cron" || requested === "traffic"
      ? requested
      : "manual";
  // cron-job.org's free tier times out at 30s. Keep scheduler invocations well
  // under that (one in-flight webhook can take up to 10s), so the scheduler
  // never records a false failure while work is still running. Manual calls
  // keep the larger platform-safe budget.
  const runtimeBudgetMs = trigger === "manual" ? 45_000 : 15_000;
  const summary = await runQueueProcessor(getDb(), { trigger, runtimeBudgetMs });
  return c.json(summary);
});

/**
 * GET /v1/jobs/status
 *
 * The observability contract for scheduling and delivery:
 * pending count, oldest pending age, due-but-unclaimed work, processing with
 * expired leases, retry counts, dead letters, webhook backlog, and the last
 * successful/failed processor run. If the scheduler never runs, the last-run
 * timestamps are what make that visible.
 */
jobs.get("/status", async (c) => {
  if (!process.env.QUEUE_PROCESSOR_SECRET) return disabled(c);
  if (!authorized(c.req.header("authorization"))) return unauthorized(c);

  const db = getDb();
  const [metrics, webhooks, last, recent] = await Promise.all([
    jobMetrics(db),
    webhookQueueMetrics(db),
    lastProcessorRuns(db),
    recentProcessorRuns(db, 10),
  ]);
  return c.json({
    jobs: metrics,
    webhooks,
    processor: {
      lastSuccess: last.lastSuccess,
      lastFailure: last.lastFailure,
      recent,
      schedulerConfigured: Boolean(process.env.QUEUE_PROCESSOR_SECRET),
      schedulerMode: process.env.QUEUE_SCHEDULER_MODE ?? "external-best-effort",
    },
  });
});

/** GET /v1/jobs/dead-letter — inspect jobs and webhook deliveries that stopped. */
jobs.get("/dead-letter", async (c) => {
  if (!process.env.QUEUE_PROCESSOR_SECRET) return disabled(c);
  if (!authorized(c.req.header("authorization"))) return unauthorized(c);

  const db = getDb();
  const [deadJobs, deadDeliveries] = await Promise.all([
    listDeadLetterJobs(db, 100),
    listFailedWebhookDeliveries(db, 100),
  ]);
  return c.json({ jobs: deadJobs, webhookDeliveries: deadDeliveries });
});

/** POST /v1/jobs/dead-letter/jobs/:id/reprocess — requeue a dead-lettered job. */
jobs.post("/dead-letter/jobs/:id/reprocess", async (c) => {
  if (!process.env.QUEUE_PROCESSOR_SECRET) return disabled(c);
  if (!authorized(c.req.header("authorization"))) return unauthorized(c);
  const result = await requeueDeadLetterJob(getDb(), c.req.param("id"));
  return c.json(result, result.requeued ? 200 : 409);
});

/**
 * POST /v1/jobs/dead-letter/webhooks/:id/reprocess — give a failed/exhausted
 * webhook delivery a fresh, fully-audited retry cycle. Delivered rows are
 * refused: replaying an accepted event is a business decision, not a retry.
 */
jobs.post("/dead-letter/webhooks/:id/reprocess", async (c) => {
  if (!process.env.QUEUE_PROCESSOR_SECRET) return disabled(c);
  if (!authorized(c.req.header("authorization"))) return unauthorized(c);
  const result = await reprocessWebhookDelivery(getDb(), c.req.param("id"));
  return c.json(result, result.requeued ? 200 : 409);
});

export default jobs;
