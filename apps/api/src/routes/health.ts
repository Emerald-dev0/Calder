import { Hono } from "hono";
import type { Env } from "../app.js";
import { createRequire } from "node:module";
import { pingRedisUrl } from "../lib/redis-ping.js";
import {
  getConfig,
  getRedisUrl,
  isHostedEnv,
  redisRequiredFor,
  describeBoot,
  ConfigurationError,
} from "@calder/config";
import { redactText, redactConnectionUrl, errorReportingStatus } from "@calder/observability";

// Loaded via require, not a static import: per-file transpilers (esbuild,
// including Vercel's) drop import attributes, which plain Node then rejects
// with ERR_IMPORT_ATTRIBUTE_MISSING. Both paths below are string literals so
// Vercel's file tracer ships openapi.json with the function; src|dist
// layouts resolve the first, the serverless bundle (apps/api/api/index.js)
// the second.
function loadOpenApiSpec(): unknown {
  const require = createRequire(import.meta.url);
  try {
    return require("../../openapi.json") as unknown;
  } catch {
    // Fall through to the bundle layout.
  }
  try {
    return require("../openapi.json") as unknown;
  } catch {
    // Fall through to the loud error below.
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

/**
 * Liveness: "is this process running and able to answer?".
 * Deliberately dependency-free — a database blip must never make an
 * orchestrator kill and restart an otherwise healthy process.
 */
health.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "api",
    checks: "liveness only",
    timestamp: new Date().toISOString(),
  });
});

type CheckState = "ok" | "degraded" | "skipped";

interface CheckResult {
  state: CheckState;
  detail?: string;
}

/**
 * Readiness: "can this process safely do its job?".
 *
 * Rules this endpoint follows, because a lie here pages someone at 3am:
 * - "unavailable" is never reported as "ok";
 * - a dependency required to do the job safely (database, queue in
 *   staging/production, the email provider in production) gates readiness;
 * - checks that are informational do not (the worker's own health is reported
 *   but never flips API readiness — delivery has its own signal set);
 * - a check that cannot run is "skipped", with the reason;
 * - details are scrubbed: no URLs with credentials, no topology, no secrets.
 */
health.get("/ready", async (c) => {
  const checks: Record<string, CheckResult> = {};
  const required: string[] = [];
  let ready = true;

  const config = getConfig();
  const hosted = isHostedEnv();

  // ── Email provider (the launch-critical one) ──────────────────
  try {
    const { resolveEmailProvider } = await import("@calder/providers");
    const status = resolveEmailProvider();
    checks.email_provider = {
      state: status.deliverable ? "ok" : "degraded",
      detail: status.deliverable
        ? `driver=${status.driver}`
        : redactText(status.reason ?? "not deliverable"),
    };
    if (!status.deliverable && config.NODE_ENV === "production") ready = false;
    required.push("email_provider");
  } catch (err) {
    // resolveEmailProvider throws in production when credentials are missing.
    checks.email_provider = {
      state: "degraded",
      detail: redactText(err instanceof Error ? err.message : "provider resolution failed"),
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
    checks.database = { state: "ok", detail: redactConnectionUrl(config.DATABASE_URL) };
    required.push("database");
  } catch (err) {
    if (!hosted) {
      // Local development/test deliberately support the in-memory scaffold.
      // Keep the database in the required-check inventory so the response is
      // honest about what a hosted launch needs, but do not turn a missing
      // local Postgres into a false-negative readiness result.
      checks.database = {
        state: "skipped",
        detail: "DATABASE_URL unavailable: local scaffold mode",
      };
      required.push("database");
    } else {
      checks.database = {
        state: "degraded",
        detail: redactText(err instanceof Error ? err.message : "query failed"),
      };
      ready = false;
      required.push("database");
    }
  }

  // ── Queue / Redis ─────────────────────────────────────────────
  // Required in staging and production; optional in development and test.
  const redisUrl = getRedisUrl();
  const queueRequired = redisRequiredFor("api");
  if (redisUrl) {
    const redis = await pingRedisUrl(redisUrl);
    checks.queue = {
      state: redis.ok ? "ok" : "degraded",
      detail: redis.ok
        ? `${redactConnectionUrl(redisUrl)} (${redis.detail})`
        : redactText(redis.detail),
    };
    if (!redis.ok) ready = false;
    required.push("queue");
  } else if (queueRequired) {
    // Should be unreachable: boot refuses to start. Kept as defence in depth
    // for a process that was constructed without the boot assertion.
    checks.queue = {
      state: "degraded",
      detail: `REDIS_URL is required in ${describeBoot("api").deployEnv} and is not set`,
    };
    ready = false;
    required.push("queue");
  } else {
    checks.queue = {
      state: "skipped",
      detail: "REDIS_URL unset: in-process queue only (development/test)",
    };
  }

  // ── Informational: worker liveness ────────────────────────────
  // Reported for operators, never gating API readiness: on serverless
  // deployments there is no worker and delivery runs through the Postgres
  // drain. Queue health has its own alert rules and endpoint.
  checks.worker = config.WORKER_EXPECTED
    ? await workerCheck(redisUrl, config.WORKER_HEARTBEAT_STALE_SECONDS, hosted)
    : {
        state: "skipped",
        detail: "WORKER_EXPECTED=false: delivery runs through the scheduled drain",
      };

  // ── Informational: rate limiter posture ───────────────────────
  // Hosted authentication limits fail closed when Redis is down; development
  // and test retain the explicit in-process limiter. The state is still
  // visible to operators and never presented as exact while degraded.
  try {
    const { getRateLimiter } = await import("@calder/rate-limit");
    const limiter = getRateLimiter() as unknown as {
      degradedState?: () => {
        fallbacks: number;
        lastFallbackAt: string | null;
        failClosed?: boolean;
      };
    };
    const state = limiter.degradedState?.();
    checks.rate_limiter = state
      ? {
          state: state.fallbacks === 0 || !state.lastFallbackAt ? "ok" : "degraded",
          detail:
            state.fallbacks === 0
              ? "exact (redis or memory only)"
              : state.failClosed
                ? `${state.fallbacks} Redis failure(s), requests rejected until recovery`
                : `${state.fallbacks} fallback(s), last at ${state.lastFallbackAt} (development/test only)`,
        }
      : { state: "ok", detail: "in-process limiter (development/test)" };
  } catch (err) {
    checks.rate_limiter = {
      state: "degraded",
      detail: redactText(err instanceof Error ? err.message : "limiter check failed"),
    };
  }

  // ── Informational: error tracking ─────────────────────────────
  const reporting = errorReportingStatus();
  checks.error_tracking = {
    state: reporting.enabled ? "ok" : "skipped",
    detail: reporting.enabled
      ? `service=${reporting.service} environment=${reporting.environment}`
      : "not configured: failures are logged only",
  };

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

async function workerCheck(
  redisUrl: string | null,
  staleSeconds: number,
  hosted: boolean
): Promise<CheckResult> {
  if (!redisUrl) {
    return {
      state: "skipped",
      detail: hosted ? "no Redis configured" : "in-process dev mode has no worker heartbeat",
    };
  }
  try {
    const { WorkerHeartbeatStore, hasFreshHeartbeat } = await import("@calder/queue");
    const store = new WorkerHeartbeatStore(redisUrl, { ttlSeconds: staleSeconds * 2 });
    try {
      const read = await store.read();
      if (!read.ok) return { state: "degraded", detail: redactText(read.detail) };
      if (read.heartbeats.length === 0) {
        return {
          state: "degraded",
          detail: "no live worker heartbeat (serverless drain may be the path)",
        };
      }
      return {
        state: hasFreshHeartbeat(read.heartbeats, staleSeconds) ? "ok" : "degraded",
        detail: `${read.heartbeats.length} worker(s), freshest ${freshestAge(read.heartbeats)}s ago`,
      };
    } finally {
      store.close();
    }
  } catch (err) {
    if (err instanceof ConfigurationError) throw err;
    return {
      state: "degraded",
      detail: redactText(err instanceof Error ? err.message : "heartbeat check failed"),
    };
  }
}

function freshestAge(heartbeats: Array<{ updatedAt: string }>): number {
  const newest = heartbeats.reduce((max, hb) => {
    const t = Date.parse(hb.updatedAt);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  return newest === 0 ? -1 : Math.round((Date.now() - newest) / 1000);
}

export default health;
