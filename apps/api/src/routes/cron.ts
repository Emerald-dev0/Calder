import { Hono } from "hono";
import type { Env } from "../app.js";
import { getDb } from "@calder/db";
import { sql } from "drizzle-orm";
import { logger } from "@calder/observability";
import { drainPendingEmails } from "../lib/drain.js";
import { runCompanyEmailSweep } from "../lib/company-email-sweep.js";
import { runQueueProcessor } from "../lib/processor.js";

const cron = new Hono<Env>();

function authorized(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const adminKey = process.env.ADMIN_API_KEY ?? "";
  if (cronSecret && token === cronSecret) return true;
  if (adminKey && token === adminKey) return true;
  // M6.1 (M8): in production, CRON_SECRET is MANDATORY — a bare
  // x-vercel-cron header is not authentication (it is forgeable from
  // anywhere). Dev keeps the convenience only.
  if (process.env.NODE_ENV === "production") return false;
  if (!cronSecret && c.req.header("x-vercel-cron") === "1") return true;
  return false;
}

// GET /v1/cron/maintenance — expire unused credits, reap crashed processor
// leases and re-verify payments that are still pending. Every step is
// idempotent, so overlapping runs are harmless.
cron.on(["GET", "POST"], "/maintenance", async (c) => {
  if (!authorized(c))
    return c.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, 401);
  const db = getDb();
  const { expireCredits, reapExpiredLeases, payments } = await import("@calder/db");
  const { verifyAndFulfil } = await import("../services/billing.js");
  const expired = await expireCredits(db);
  const reaped = await reapExpiredLeases(db);
  let reconciled = 0;
  let reconcileFailed = 0;
  if (process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_USD_ENABLED === "true") {
    const stale = await db
      .select({ reference: payments.reference })
      .from(payments)
      .where(
        sql`${payments.status} = 'pending' and ${payments.createdAt} < now() - interval '30 minutes'`
      )
      .limit(10);
    for (const row of stale) {
      try {
        await verifyAndFulfil(db, row.reference);
        reconciled++;
      } catch {
        reconcileFailed++;
      }
    }
  }
  return c.json({
    expiredCreditPurchases: expired,
    reapedLeases: reaped,
    reconciled,
    reconcileFailed,
  });
});

// GET /v1/cron/drain — Vercel Cron hits this on a schedule (Vercel Cron sends
// GET). POST is the queue wake-up (`kickDrain` nudges the drain right after a
// send is accepted so confirmations leave immediately). Same handler, both
// methods: the scheduled run stays a safety net for retries and delayed sends.
//
// This is the ONLY delivery-drain endpoint in the platform (the dashboard
// twin was deleted, see Phase 0 / M0.2). Delivery logic lives in lib/drain.ts;
// overlapping invocations are safe thanks to the FOR UPDATE SKIP LOCKED lease.
cron.on(["GET", "POST"], "/drain", async (c) => {
  if (!authorized(c))
    return c.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, 401);
  const db = getDb();
  const result = await drainPendingEmails(db);
  // The same daily invocation also runs a short bounded processor pass so
  // webhook retries and scheduled jobs are not left entirely to the external
  // five-minute workflow. Vercel Hobby allows only two cron jobs, so this must
  // stay part of the existing drain entry rather than a third schedule.
  const processor = await runQueueProcessor(db, {
    trigger: "cron",
    maxJobs: 10,
    runtimeBudgetMs: 20_000,
  });
  return c.json({ ...result, processor });
});

/**
 * GET/POST /v1/cron/process — the platform-owned backstop trigger for the
 * bounded queue processor. Vercel Hobby cron can only run daily, so this is a
 * safety net, not the primary scheduler: the external five-minute workflow
 * (`QUEUE_PROCESSOR_SECRET`) is the best-effort clock. Both call the same
 * bounded processor and are safe to overlap.
 */
cron.on(["GET", "POST"], "/process", async (c) => {
  if (!authorized(c))
    return c.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, 401);
  const summary = await runQueueProcessor(getDb(), { trigger: "cron" });
  return c.json(summary);
});

/**
 * GET/POST /v1/cron/alerts — evaluate every operational alert rule and return
 * the result. Deliberately reachable by any monitor with the shared secret:
 * alerting must not depend on a monitoring vendor being wired up first, and a
 * human must be able to ask the same question with curl.
 *
 * Returns 503 when any **critical** alert is active, so a plain uptime monitor
 * pointed at this URL pages without parsing JSON. 200 means "no alerts".
 */
cron.on(["GET", "POST"], "/alerts", async (c) => {
  if (!authorized(c))
    return c.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, 401);

  const { evaluateOperationalAlerts } = await import("../lib/operational-alerts.js");
  const evaluation = await evaluateOperationalAlerts();

  if (evaluation.alerts.length > 0) {
    logger.warn(
      {
        alerts: evaluation.alerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          summary: a.summary,
        })),
      },
      `operational alerts active: ${evaluation.alerts.length}`
    );
  }

  const critical = evaluation.alerts.some((a) => a.severity === "critical");
  return c.json(evaluation, critical ? 503 : 200);
});

/**
 * POST/GET /cron/aggregate-usage — fold the per-email meter entries
 * (usage_records) into per-org period rollups (usage_summaries) for the
 * CURRENT period of every org. Idempotent: deterministic summary ids +
 * upsert, so re-running always converges to the same numbers (M2.1).
 */
cron.on(["GET", "POST"], "/aggregate-usage", async (c) => {
  if (!authorized(c)) return c.json({ ok: false, error: "unauthorized" }, 401);
  try {
    const { getDb, aggregateUsageNow } = await import("@calder/db");
    const summaries = await aggregateUsageNow(getDb());
    logger.info({ summaries }, "Usage aggregation completed");
    return c.json({ ok: true, data: { summaries } });
  } catch (err) {
    logger.error({ err }, "Usage aggregation failed");
    return c.json({ ok: false, error: "aggregation_failed" }, 500);
  }
});

/**
 * GET/POST /v1/cron/company-email — the time-driven half of Calder's own mail.
 *
 * Invitations that lapse in two days and API keys that stop working in seven
 * are the only things here: both are dated facts, both are deduped by an
 * idempotency key that contains that date, so an extra run is free.
 */
cron.on(["GET", "POST"], "/company-email", async (c) => {
  if (!authorized(c))
    return c.json({ error: { code: "unauthorized", message: "Invalid cron secret" } }, 401);
  try {
    const result = await runCompanyEmailSweep(getDb());
    return c.json({ ok: true, data: result });
  } catch (err) {
    logger.error({ err }, "Company email sweep failed");
    return c.json({ ok: false, error: "sweep_failed" }, 500);
  }
});

export default cron;
