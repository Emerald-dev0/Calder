import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sql } from "drizzle-orm";
import { pingRedisUrl, queueDriverForThisProcess, type Queue } from "@calder/queue";
import { getConfig, getRedisUrl, isHostedEnv } from "@calder/config";
import {
  alertThresholdsFromEnv,
  evaluateAlerts,
  formatAlert,
  redactText,
  type AlertSignals,
} from "@calder/observability";
import { workerStatsSnapshot } from "./worker-stats.js";

type CheckState = "ok" | "degraded" | "skipped";

interface CheckResult {
  state: CheckState;
  detail?: string;
}

export interface HealthServerOptions {
  workerId: string;
  queues: Queue<unknown>[];
}

/**
 * Worker health.
 *
 * - `/health`  liveness: the process is running. Dependency-free on purpose.
 * - `/ready`   readiness: Redis reachable, database reachable, and the worker
 *              has published a heartbeat recently. Returns 503 when not.
 * - `/status`  the operational picture: job counters, queue metrics, active
 *              alerts. This is the endpoint an operator (or the alert sweep)
 *              reads during an incident.
 *
 * Nothing here exposes credentials or internal topology.
 */
export function createHealthServer(opts: HealthServerOptions) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/health") {
      return json(res, 200, {
        status: "ok",
        service: "worker",
        checks: "liveness only",
        timestamp: new Date().toISOString(),
      });
    }

    if (url === "/ready") {
      const { ready, checks } = await readiness(opts);
      return json(res, ready ? 200 : 503, {
        status: ready ? "ready" : "degraded",
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    if (url === "/status") {
      const payload = await statusPayload(opts);
      return json(res, 200, payload);
    }

    return json(res, 404, { error: { code: "not_found", message: "Not found" } });
  });
}

async function readiness(opts: HealthServerOptions): Promise<{
  ready: boolean;
  checks: Record<string, CheckResult>;
}> {
  const checks: Record<string, CheckResult> = {};
  let ready = true;
  const config = getConfig();
  const redisUrl = getRedisUrl();

  // Driver: in-memory queues are never durable, and a hosted process should
  // never have been able to construct one (boot refuses). Defence in depth.
  const driver = queueDriverForThisProcess();
  if (driver === "memory" && isHostedEnv()) {
    checks.queue_driver = { state: "degraded", detail: "in-memory queue in a hosted environment" };
    ready = false;
  } else {
    checks.queue_driver = { state: "ok", detail: driver };
  }

  if (redisUrl) {
    const ping = await pingRedisUrl(redisUrl);
    checks.redis = { state: ping.ok ? "ok" : "degraded", detail: redactText(ping.detail) };
    if (!ping.ok) ready = false;
  } else {
    checks.redis = { state: "skipped", detail: "REDIS_URL unset (development/test)" };
    if (isHostedEnv()) ready = false;
  }

  try {
    const { getDb } = await import("@calder/db");
    await getDb().execute(sql`select 1`);
    checks.database = { state: "ok" };
  } catch (err) {
    checks.database = {
      state: "degraded",
      detail: redactText(err instanceof Error ? err.message : "query failed"),
    };
    ready = false;
  }

  const stats = workerStatsSnapshot(opts.workerId);
  const heartbeatAge = stats.lastHeartbeatAt
    ? Math.round((Date.now() - Date.parse(stats.lastHeartbeatAt)) / 1000)
    : null;
  const staleAfter = config.WORKER_HEARTBEAT_STALE_SECONDS;
  if (!redisUrl) {
    checks.heartbeat = { state: "skipped", detail: "no Redis heartbeat store configured" };
  } else if (heartbeatAge === null) {
    // A worker that has never published a heartbeat is not yet (or no longer)
    // doing its job. Reporting ready here would hide a worker that boots and
    // then cannot reach its own queue.
    checks.heartbeat = {
      state: "degraded",
      detail:
        stats.heartbeatFailures > 0
          ? `heartbeat has never been published (${stats.heartbeatFailures} failure(s))`
          : "heartbeat has never been published",
    };
    ready = false;
  } else if (heartbeatAge > staleAfter) {
    checks.heartbeat = { state: "degraded", detail: `${heartbeatAge}s old (stale)` };
    ready = false;
  } else {
    checks.heartbeat = { state: "ok", detail: `${heartbeatAge}s old` };
  }

  return { ready, checks };
}

async function statusPayload(opts: HealthServerOptions) {
  const config = getConfig();
  const stats = workerStatsSnapshot(opts.workerId);
  const signals: AlertSignals = {
    exhaustedJobs: stats.exhausted,
  };
  const unavailable: Record<string, string> = {};

  const redisUrl = getRedisUrl();
  if (redisUrl) {
    const ping = await pingRedisUrl(redisUrl);
    signals.redisOk = ping.ok;
    if (!ping.ok) unavailable.redis = redactText(ping.detail);
  }

  try {
    const { getDb } = await import("@calder/db");
    await getDb().execute(sql`select 1`);
    signals.databaseOk = true;
  } catch (err) {
    signals.databaseOk = false;
    unavailable.database = redactText(err instanceof Error ? err.message : "query failed");
  }

  const queueMetrics = [];
  let depth = 0;
  let dlq = 0;
  let oldest: number | null = null;
  for (const queue of opts.queues) {
    if (!queue.metrics) continue;
    try {
      const metrics = await queue.metrics();
      queueMetrics.push(metrics);
      depth += metrics.waiting + metrics.active;
      dlq += metrics.failed;
      if (metrics.oldestWaitingAgeSeconds !== null) {
        oldest =
          oldest === null
            ? metrics.oldestWaitingAgeSeconds
            : Math.max(oldest, metrics.oldestWaitingAgeSeconds);
      }
    } catch (err) {
      unavailable[`queue:${queue.name}`] = redactText(
        err instanceof Error ? err.message : "metrics failed"
      );
    }
  }
  if (queueMetrics.length > 0) {
    signals.queueDepth = depth;
    signals.dlqDepth = dlq;
    signals.oldestJobAgeSeconds = oldest;
  }

  const alerts = evaluateAlerts(signals, alertThresholdsFromEnv());

  return {
    service: "worker",
    workerId: opts.workerId,
    driver: queueDriverForThisProcess(),
    deployEnv: config.NODE_ENV,
    driver_configured: Boolean(redisUrl),
    stats,
    queues: queueMetrics,
    signals,
    alerts,
    alertSummary: alerts.map(formatAlert),
    unavailable,
    timestamp: new Date().toISOString(),
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
