import { sql, eq, and, lte, isNull, or, count } from "drizzle-orm";
import {
  createQueue,
  pingRedisUrl,
  QUEUE_NAMES,
  WorkerHeartbeatStore,
  type Queue,
} from "@calder/queue";
import { getConfig, getRedisUrl } from "@calder/config";
import {
  ALERT_CATALOG,
  alertThresholdsFromEnv,
  apiRequestMetrics,
  evaluateAlerts,
  queueEnqueueFailures,
  exhaustedJobs,
  providerFailures,
  type ActiveAlert,
  type AlertSignals,
} from "@calder/observability";

/**
 * One evaluation of every operational alert rule, from the API's point of view.
 *
 * Reached through `GET /v1/cron/alerts` (CRON_SECRET-guarded) so any external
 * monitor — or a human with curl — can ask "is anything on fire?" without a
 * monitoring vendor being wired up. The same signals are visible in the
 * response, so an alert is never a number you cannot re-derive.
 */
export interface AlertsEvaluation {
  ok: boolean;
  evaluatedAt: string;
  windowMinutes: number;
  alerts: ActiveAlert[];
  signals: AlertSignals;
  /** Signals that could not be measured, with the reason. */
  unavailable: Record<string, string>;
}

async function checkDatabase(): Promise<{
  ok: boolean;
  detail?: string;
  queuedEmailCount?: number;
  oldestQueuedEmailAgeSeconds?: number | null;
}> {
  try {
    const { getDb, emails } = await import("@calder/db");
    const db = getDb();
    await db.execute(sql`select 1`);

    // Durable truth: emails accepted into "queued" that the drain has not
    // delivered. Independent of Redis, which is why it is its own alert.
    const due = or(isNull(emails.scheduledFor), lte(emails.scheduledFor, new Date()))!;
    const [row] = await db
      .select({
        value: count(),
        oldest: sql<Date | null>`min(${emails.createdAt})`,
      })
      .from(emails)
      .where(and(eq(emails.status, "queued"), due));
    const oldest = row?.oldest ? new Date(row.oldest as unknown as string) : null;
    return {
      ok: true,
      queuedEmailCount: Number(row?.value ?? 0),
      oldestQueuedEmailAgeSeconds: oldest
        ? Math.round((Date.now() - oldest.getTime()) / 1000)
        : null,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "database check failed" };
  }
}

export async function evaluateOperationalAlerts(): Promise<AlertsEvaluation> {
  const config = getConfig();
  const thresholds = alertThresholdsFromEnv();
  const windowMinutes = config.ALERT_WINDOW_MINUTES;
  const redisUrl = getRedisUrl();
  const signals: AlertSignals = {};
  const unavailable: Record<string, string> = {};

  const db = await checkDatabase();
  signals.databaseOk = db.ok;
  if (!db.ok && db.detail) unavailable.database = db.detail;
  if (db.queuedEmailCount !== undefined) signals.queuedEmailCount = db.queuedEmailCount;
  if (db.oldestQueuedEmailAgeSeconds !== undefined)
    signals.oldestQueuedEmailAgeSeconds = db.oldestQueuedEmailAgeSeconds;

  if (redisUrl) {
    const ping = await pingRedisUrl(redisUrl);
    signals.redisOk = ping.ok;
    if (!ping.ok) unavailable.redis = ping.detail;

    // Queue metrics + worker liveness. Both are best-effort: a failure here is
    // already reported by the redis_unavailable rule, not by a crash.
    const queues: Queue<unknown>[] = [];
    try {
      for (const name of Object.values(QUEUE_NAMES)) {
        queues.push(createQueue(name, { redisUrl }) as Queue<unknown>);
      }
      let depth = 0;
      let dlq = 0;
      let oldestJobAgeSeconds: number | null = null;
      for (const queue of queues) {
        try {
          const metrics = await queue.metrics!();
          depth += metrics.waiting + metrics.active;
          dlq += metrics.failed;
          if (metrics.oldestWaitingAgeSeconds !== null) {
            oldestJobAgeSeconds =
              oldestJobAgeSeconds === null
                ? metrics.oldestWaitingAgeSeconds
                : Math.max(oldestJobAgeSeconds, metrics.oldestWaitingAgeSeconds);
          }
        } catch (err) {
          unavailable[`queue:${queue.name}`] =
            err instanceof Error ? err.message : "metrics failed";
        }
      }
      signals.queueDepth = depth;
      signals.dlqDepth = dlq;
      signals.oldestJobAgeSeconds = oldestJobAgeSeconds;
    } finally {
      for (const queue of queues) await queue.close().catch(() => undefined);
    }

    if (!config.WORKER_EXPECTED) {
      unavailable.worker = "WORKER_EXPECTED=false: delivery runs through the scheduled drain";
    }
    const store = config.WORKER_EXPECTED
      ? new WorkerHeartbeatStore(redisUrl, {
          ttlSeconds: config.WORKER_HEARTBEAT_STALE_SECONDS * 2,
        })
      : null;
    if (store) {
      try {
        const read = await store.read();
        if (read.ok) {
          signals.workerHeartbeatCount = read.heartbeats.length;
          const freshest = read.heartbeats.reduce((max, hb) => {
            const t = Date.parse(hb.updatedAt);
            return Number.isFinite(t) && t > max ? t : max;
          }, 0);
          signals.freshestHeartbeatAgeSeconds =
            freshest === 0 ? null : Math.round((Date.now() - freshest) / 1000);
          if (read.heartbeats.length === 0) unavailable.worker = "no worker heartbeat found";
        } else {
          unavailable.worker = read.detail;
        }
      } finally {
        store.close();
      }
    }
  } else {
    unavailable.redis = "REDIS_URL unset: queue and worker signals not measured";
    unavailable.worker = "REDIS_URL unset: worker heartbeat not measured";
  }

  // In-process API counters (reset on deploy — that is the honest window).
  const api = apiRequestMetrics.snapshot(config.API_ALERT_WINDOW_MINUTES);
  signals.apiRequests = api.requests;
  signals.api5xx = api.errors5xx;
  signals.apiSlowestMs = api.slowestMs;
  signals.enqueueFailures = queueEnqueueFailures.value();

  // Counters owned by the worker process are reported by the worker itself
  // (`/status`); if they are non-zero here they come from this process.
  const exhausted = exhaustedJobs.value();
  const provider = providerFailures.value();
  if (exhausted > 0) signals.exhaustedJobs = exhausted;
  if (provider > 0) signals.providerFailures = provider;

  const alerts = evaluateAlerts(signals, thresholds);
  return {
    ok: alerts.length === 0,
    evaluatedAt: new Date().toISOString(),
    windowMinutes,
    alerts,
    signals,
    unavailable,
  };
}

/** Rendered catalog, for documentation tooling and the /v1/cron/alerts payload. */
export function alertCatalog() {
  return ALERT_CATALOG;
}
