import { getConfig } from "@calder/config";

/**
 * Alert rules.
 *
 * Every rule in this file answers one question an operator would actually ask
 * during an incident ("is anything draining the queue?", "is the worker
 * alive?"), and every one is documented in docs/OPERATIONS.md with a first
 * response. Rules that only decorate a dashboard are deliberately absent.
 *
 * Evaluation is a pure function over signals so it can run in the API
 * (cron-triggered sweep), in the worker (in-process counters) and in tests
 * without any of them agreeing on infrastructure.
 */

export type AlertId =
  | "redis_unavailable"
  | "database_unavailable"
  | "queue_enqueue_failures"
  | "queue_depth_high"
  | "queue_oldest_job_stale"
  | "queue_dlq_growth"
  | "queued_email_age"
  | "worker_no_heartbeat"
  | "worker_repeated_job_failures"
  | "api_5xx_rate"
  | "api_latency_degraded"
  | "provider_failure_sustained";

export type AlertSeverity = "critical" | "warning";

export interface AlertDefinition {
  id: AlertId;
  title: string;
  severity: AlertSeverity;
  /** Human trigger description, mirrored into the OPERATIONS.md table. */
  trigger: string;
  meaning: string;
  check: string;
  response: string;
}

/** The catalog rendered into docs/OPERATIONS.md § Alerting. */
export const ALERT_CATALOG: AlertDefinition[] = [
  {
    id: "redis_unavailable",
    title: "Redis unavailable",
    severity: "critical",
    trigger: "PING to REDIS_URL fails or times out",
    meaning:
      "The durable queue cannot accept or hand out jobs. Delivery can continue from Postgres via the drain, but retries and delayed sends are not being queued.",
    check:
      "Redis provider status page, connection count, memory; `redis-cli ping` from the deploy host.",
    response:
      "Restore Redis or fail over to the replica. Do NOT disable the queue to 'work around' it: the API keeps persisting queued rows and the drain keeps delivering them.",
  },
  {
    id: "database_unavailable",
    title: "Database unavailable",
    severity: "critical",
    trigger: "`select 1` against DATABASE_URL fails",
    meaning: "Nothing can be accepted, sent, metered or read. This is a full outage.",
    check: "Provider status, connection limits (`DB_POOL_MAX`), recent migrations, disk.",
    response: "Follow the database outage runbook; do not deploy during the outage.",
  },
  {
    id: "queue_enqueue_failures",
    title: "Repeated enqueue failures",
    severity: "critical",
    trigger: "Enqueue failures in the window at or above QUEUE_ENQUEUE_FAILURE_WARN",
    meaning:
      "Accepted sends are persisted but the queue refused them. Nothing is lost (the drain picks them up), but delivery is now scheduled rather than immediate.",
    check: "Redis availability, connection limits, producer timeouts (REDIS_ENQUEUE_TIMEOUT_MS).",
    response:
      "Treat as Redis degradation. Confirm the drain is running (`/v1/cron/drain` responses) so queued mail still leaves.",
  },
  {
    id: "queue_depth_high",
    title: "Queue depth abnormal",
    severity: "warning",
    trigger: "Waiting jobs above QUEUE_DEPTH_WARN",
    meaning:
      "Arrival rate exceeds processing rate, or consumers are slower than usual. Depth alone is not an incident; sustained growth is.",
    check: "Worker count and concurrency, provider latency, recent deploy.",
    response: "Scale consumers or raise WORKER_CONCURRENCY; check provider latency first.",
  },
  {
    id: "queue_oldest_job_stale",
    title: "Oldest job too old",
    severity: "critical",
    trigger: "Oldest waiting job older than QUEUE_OLDEST_JOB_WARN_MINUTES",
    meaning:
      "Jobs are being enqueued but not processed: no live consumer, or a consumer that is stuck on something.",
    check: "Worker heartbeat/status endpoint, worker logs, Redis connectivity.",
    response:
      "Restart or scale the worker; confirm the heartbeat returns before declaring recovery.",
  },
  {
    id: "queue_dlq_growth",
    title: "Dead-letter accumulation",
    severity: "warning",
    trigger: "Exhausted (failed) jobs above QUEUE_DLQ_WARN",
    meaning:
      "Jobs have burned every retry. Each one is a delivery that did not happen and a customer who may not know.",
    check: "Worker logs for the failure reason, provider status, `emails.status='failed'` rows.",
    response: "Triage the failure cause, then replay affected emails after the cause is fixed.",
  },
  {
    id: "queued_email_age",
    title: "Queued emails not being delivered",
    severity: "critical",
    trigger:
      "Emails in the durable `queued` state older than QUEUE_OLDEST_JOB_WARN_MINUTES in Postgres",
    meaning:
      "The Postgres-backed truth (not Redis) shows accepted mail sitting undelivered — the drain is not running or is failing.",
    check: "Cron schedule, `/v1/cron/drain` response, provider credentials, drain logs.",
    response: "Run the drain manually (`POST /v1/cron/drain`) and watch the response counts.",
  },
  {
    id: "worker_no_heartbeat",
    title: "Worker not processing jobs",
    severity: "critical",
    trigger: "No worker heartbeat fresher than WORKER_HEARTBEAT_STALE_SECONDS",
    meaning:
      "No consumer has checked in. On serverless deploys this is expected; where a worker runs, it is an outage.",
    check: "Worker process/host health, worker `/health` + `/ready`, its Redis and DB access.",
    response:
      "Restart the worker; verify one email moves from queued to sent before closing the incident.",
  },
  {
    id: "worker_repeated_job_failures",
    title: "Repeated job failures",
    severity: "warning",
    trigger: "Exhausted jobs in the window at or above WORKER_JOB_FAILURE_WARN",
    meaning: "A shared cause is failing many deliveries (provider, credentials, or a bad deploy).",
    check: "Group recent failures by error code in worker logs.",
    response:
      "Stop the bleeding (pause sends if it is a provider/credential issue), fix, then replay.",
  },
  {
    id: "api_5xx_rate",
    title: "Elevated 5xx rate",
    severity: "critical",
    trigger:
      "5xx share above API_5XX_WARN_PERCENT over the last API_ALERT_WINDOW_MINUTES, with at least API_5XX_MIN_REQUESTS requests",
    meaning: "The API is failing requests it should be able to serve.",
    check: "Error tracking (grouped by classification), recent deploy, database/Redis readiness.",
    response: "If it began at a deploy: roll back first, diagnose second.",
  },
  {
    id: "api_latency_degraded",
    title: "Sustained latency degradation",
    severity: "warning",
    trigger: "Slowest request in the window above API_LATENCY_WARN_MS",
    meaning: "Something downstream (database, Redis, provider, or a lock) got slower.",
    check: "Per-route duration in logs, database slow queries, Redis latency.",
    response: "Identify the route, then the dependency; do not raise the threshold to silence it.",
  },
  {
    id: "provider_failure_sustained",
    title: "Sustained provider failure",
    severity: "warning",
    trigger: "Provider send failures in the window at or above PROVIDER_FAILURE_WARN",
    meaning: "The email provider is rejecting or erroring at a rate above normal noise.",
    check: "Provider status page, SES reputation/bounce metrics, credentials and sending identity.",
    response:
      "Confirm whether failures are transient (retries will cover) or permanent (credentials/quota); pause new sends if reputation is at risk.",
  },
];

export interface AlertSignals {
  /** Redis PING from the evaluating process. `undefined` = not checked. */
  redisOk?: boolean;
  databaseOk?: boolean;
  /** Enqueue failures observed in the window. */
  enqueueFailures?: number;
  /** Queue metrics, per queue. */
  queueDepth?: number;
  oldestJobAgeSeconds?: number | null;
  dlqDepth?: number;
  /** Durable queued rows in Postgres (serverless drain path). */
  queuedEmailCount?: number;
  oldestQueuedEmailAgeSeconds?: number | null;
  /** Worker liveness. */
  workerHeartbeatCount?: number;
  freshestHeartbeatAgeSeconds?: number | null;
  /** Window aggregates. */
  exhaustedJobs?: number;
  providerFailures?: number;
  apiRequests?: number;
  api5xx?: number;
  apiSlowestMs?: number;
}

export interface ActiveAlert {
  id: AlertId;
  title: string;
  severity: AlertSeverity;
  /** One line an operator can act on, with the measured value. */
  summary: string;
  details: Record<string, unknown>;
}

export interface AlertThresholds {
  queueDepthWarn: number;
  oldestJobWarnSeconds: number;
  dlqWarn: number;
  enqueueFailureWarn: number;
  workerHeartbeatStaleSeconds: number;
  workerJobFailureWarn: number;
  api5xxWarnPercent: number;
  api5xxMinRequests: number;
  apiLatencyWarnMs: number;
  providerFailureWarn: number;
}

export function alertThresholdsFromEnv(): AlertThresholds {
  const config = getConfig();
  return {
    queueDepthWarn: config.QUEUE_DEPTH_WARN,
    oldestJobWarnSeconds: config.QUEUE_OLDEST_JOB_WARN_MINUTES * 60,
    dlqWarn: config.QUEUE_DLQ_WARN,
    enqueueFailureWarn: config.QUEUE_ENQUEUE_FAILURE_WARN,
    workerHeartbeatStaleSeconds: config.WORKER_HEARTBEAT_STALE_SECONDS,
    workerJobFailureWarn: config.WORKER_JOB_FAILURE_WARN,
    api5xxWarnPercent: config.API_5XX_WARN_PERCENT,
    api5xxMinRequests: config.API_5XX_MIN_REQUESTS,
    apiLatencyWarnMs: config.API_LATENCY_WARN_MS,
    providerFailureWarn: config.PROVIDER_FAILURE_WARN,
  };
}

function definition(id: AlertId): AlertDefinition {
  const found = ALERT_CATALOG.find((alert) => alert.id === id);
  if (!found) throw new Error(`unknown alert id: ${id}`);
  return found;
}

/**
 * Evaluate every rule against the signals that were actually measured.
 * A signal that is `undefined` is skipped — never alert on an unknown.
 */
export function evaluateAlerts(
  signals: AlertSignals,
  thresholds: AlertThresholds = alertThresholdsFromEnv()
): ActiveAlert[] {
  const active: ActiveAlert[] = [];
  const raise = (id: AlertId, summary: string, details: Record<string, unknown>) => {
    const def = definition(id);
    active.push({ id: def.id, title: def.title, severity: def.severity, summary, details });
  };

  if (signals.redisOk === false) {
    raise("redis_unavailable", "Redis PING failed", {});
  }

  if (signals.databaseOk === false) {
    raise("database_unavailable", "Database query failed", {});
  }

  if (
    signals.enqueueFailures !== undefined &&
    signals.enqueueFailures >= thresholds.enqueueFailureWarn
  ) {
    raise("queue_enqueue_failures", `${signals.enqueueFailures} enqueue failure(s) in the window`, {
      enqueueFailures: signals.enqueueFailures,
    });
  }

  if (signals.queueDepth !== undefined && signals.queueDepth > thresholds.queueDepthWarn) {
    raise("queue_depth_high", `queue depth ${signals.queueDepth}`, {
      queueDepth: signals.queueDepth,
      threshold: thresholds.queueDepthWarn,
    });
  }

  if (
    signals.oldestJobAgeSeconds !== undefined &&
    signals.oldestJobAgeSeconds !== null &&
    signals.oldestJobAgeSeconds > thresholds.oldestJobWarnSeconds
  ) {
    raise(
      "queue_oldest_job_stale",
      `oldest waiting job is ${Math.round(signals.oldestJobAgeSeconds / 60)}m old`,
      { oldestJobAgeSeconds: signals.oldestJobAgeSeconds }
    );
  }

  if (signals.dlqDepth !== undefined && signals.dlqDepth > thresholds.dlqWarn) {
    raise("queue_dlq_growth", `${signals.dlqDepth} dead-lettered job(s)`, {
      dlqDepth: signals.dlqDepth,
      threshold: thresholds.dlqWarn,
    });
  }

  if (
    signals.oldestQueuedEmailAgeSeconds !== undefined &&
    signals.oldestQueuedEmailAgeSeconds !== null &&
    signals.oldestQueuedEmailAgeSeconds > thresholds.oldestJobWarnSeconds
  ) {
    raise(
      "queued_email_age",
      `oldest queued email is ${Math.round(signals.oldestQueuedEmailAgeSeconds / 60)}m old`,
      {
        oldestQueuedEmailAgeSeconds: signals.oldestQueuedEmailAgeSeconds,
        queuedEmailCount: signals.queuedEmailCount,
      }
    );
  }

  if (
    signals.freshestHeartbeatAgeSeconds !== undefined &&
    (signals.workerHeartbeatCount ?? 0) >= 0 &&
    (signals.freshestHeartbeatAgeSeconds === null ||
      signals.freshestHeartbeatAgeSeconds > thresholds.workerHeartbeatStaleSeconds)
  ) {
    raise(
      "worker_no_heartbeat",
      signals.freshestHeartbeatAgeSeconds === null
        ? "no worker heartbeat found"
        : `freshest worker heartbeat is ${signals.freshestHeartbeatAgeSeconds}s old`,
      {
        workerHeartbeatCount: signals.workerHeartbeatCount ?? 0,
        freshestHeartbeatAgeSeconds: signals.freshestHeartbeatAgeSeconds,
      }
    );
  }

  if (
    signals.exhaustedJobs !== undefined &&
    signals.exhaustedJobs >= thresholds.workerJobFailureWarn
  ) {
    raise(
      "worker_repeated_job_failures",
      `${signals.exhaustedJobs} exhausted job(s) in the window`,
      {
        exhaustedJobs: signals.exhaustedJobs,
      }
    );
  }

  if (
    signals.apiRequests !== undefined &&
    signals.api5xx !== undefined &&
    signals.apiRequests >= thresholds.api5xxMinRequests &&
    (signals.api5xx / signals.apiRequests) * 100 > thresholds.api5xxWarnPercent
  ) {
    const percent = ((signals.api5xx / signals.apiRequests) * 100).toFixed(1);
    raise("api_5xx_rate", `${percent}% of ${signals.apiRequests} requests returned 5xx`, {
      apiRequests: signals.apiRequests,
      api5xx: signals.api5xx,
    });
  }

  if (signals.apiSlowestMs !== undefined && signals.apiSlowestMs > thresholds.apiLatencyWarnMs) {
    raise("api_latency_degraded", `slowest request ${signals.apiSlowestMs}ms`, {
      apiSlowestMs: signals.apiSlowestMs,
      threshold: thresholds.apiLatencyWarnMs,
    });
  }

  if (
    signals.providerFailures !== undefined &&
    signals.providerFailures >= thresholds.providerFailureWarn
  ) {
    raise("provider_failure_sustained", `${signals.providerFailures} provider failure(s)`, {
      providerFailures: signals.providerFailures,
    });
  }

  return active;
}

/** Stable one-line rendering used in logs, the worker /status payload and PR evidence. */
export function formatAlert(alert: ActiveAlert): string {
  return `[${alert.severity}] ${alert.id}: ${alert.summary}`;
}
