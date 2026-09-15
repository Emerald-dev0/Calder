import { Hono } from "hono";
import type { Env } from "../app.js";
import { createRequire } from "node:module";
import { pingRedis } from "../lib/redis-ping.js";

// Loaded via require, not a static import: per-file transpilers (esbuild,
// including Vercel's) drop import attributes, which plain Node then rejects
// with ERR_IMPORT_ATTRIBUTE_MISSING. The spec is resolved relative to this
// file, so both layouts work: src|dist/routes/*.js use ../../, while the
// serverless bundle (apps/api/api/index.js) uses ../.
function loadOpenApiSpec(): unknown {
  const require = createRequire(import.meta.url);
  for (const rel of ["../../openapi.json", "../openapi.json"]) {
    try {
      return require(rel) as unknown;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error("openapi.json not found relative to the health route");
}
const spec = loadOpenApiSpec();

const health = new Hono<Env>();

// The OpenAPI document, served live so SDKs and docs never drift from code.
// Mounted at /v1/openapi.json (health router lives at root).
health.get("/v1/openapi.json", (c) => {
  return c.json(spec);
});

health.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

type CheckState = "ok" | "degraded" | "skipped";

/**
 * Readiness, with real checks and honest states.
 *
 * Rules this endpoint follows, because a lie here pages someone at 3am:
 * - "unavailable" is never reported as "ok"
 * - a check that cannot run is "skipped", with the reason
 * - the email provider check is the one that matters most for launch:
 *   a production deploy without credentials can accept sends and deliver
 *   nothing, so `/ready` refuses to say ready in that state.
 */
health.get("/ready", async (c) => {
  const checks: Record<string, { state: CheckState; detail?: string }> = {};
  const required: string[] = [];
  let ready = true;

  // ── Email provider (the launch-critical one) ──────────────────
  try {
    const { resolveEmailProvider } = await import("@calder/providers");
    const status = resolveEmailProvider();
    checks.email_provider = {
      state: status.deliverable ? "ok" : "degraded",
      detail: status.deliverable
        ? `driver=${status.driver}`
        : `${status.reason ?? "not deliverable"}`,
    };
    if (!status.deliverable && process.env.NODE_ENV === "production") ready = false;
    required.push("email_provider");
  } catch (err) {
    // resolveEmailProvider throws in production when credentials are missing.
    checks.email_provider = {
      state: "degraded",
      detail: err instanceof Error ? err.message : "provider resolution failed",
    };
    ready = false;
    required.push("email_provider");
  }

  // ── Database ──────────────────────────────────────────────────
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    checks.database = { state: "ok" };
    required.push("database");
  } catch (err) {
    checks.database = {
      state: process.env.DATABASE_URL ? "degraded" : "skipped",
      detail: err instanceof Error ? err.message : "query failed",
    };
    if (process.env.DATABASE_URL) ready = false;
  }

  // ── Queue / Redis ─────────────────────────────────────────────
  if (process.env.REDIS_URL) {
    const redis = await pingRedis(process.env.REDIS_URL);
    checks.queue = {
      state: redis.ok ? "ok" : "degraded",
      detail: redis.detail,
    };
    if (!redis.ok) ready = false;
    required.push("queue");
  } else {
    checks.queue = {
      state: "skipped",
      detail: "REDIS_URL unset, in-process queue only (single instance)",
    };
  }

  return c.json(
    {
      status: ready ? "ready" : "degraded",
      checks,
      required,
      timestamp: new Date().toISOString(),
    },
    ready ? 200 : 503
  );
});

export default health;
