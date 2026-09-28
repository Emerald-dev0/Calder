import { Hono } from "hono";
import type { Env } from "../app.js";
import { getDb } from "@calder/db";
import { logger } from "@calder/observability";
import { drainPendingEmails } from "../lib/drain.js";

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
  const result = await drainPendingEmails(getDb());
  return c.json(result);
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

export default cron;
