import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getConfig, assertQueueBootConfig, describeBoot, redisTargetLabel } from "@calder/config";
import {
  WorkerHeartbeatStore,
  pingRedisUrl,
  queueDriverForThisProcess,
  type Queue,
} from "@calder/queue";
import {
  captureMessage,
  errorReportingReady,
  evaluateAlerts,
  alertThresholdsFromEnv,
  formatAlert,
  initErrorReporting,
  logger,
  flushErrorReporting,
  exhaustedJobs,
  providerFailures,
} from "@calder/observability";
import { startWorker } from "./worker.js";
import { startWebhookConsumer } from "./webhook-consumer.js";
import { createHealthServer } from "./health.js";
import { recordHeartbeat, workerStatsSnapshot } from "./worker-stats.js";

const config = getConfig();
const workerId = `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

async function main() {
  // ── Boot-time operational assertions ───────────────────────────
  // A worker without Redis cannot consume anything durable: it would run an
  // in-process queue that receives no work from the API at all. Fail loudly.
  const redisUrl = assertQueueBootConfig("worker");
  const boot = describeBoot("worker");
  void initErrorReporting({ service: "worker" });

  logger.info(
    {
      ...boot,
      workerId,
      redisTarget: redisTargetLabel(redisUrl),
      concurrency: config.WORKER_CONCURRENCY,
    },
    `Starting Calder worker (${boot.deployEnv})`
  );

  const queues: Queue<unknown>[] = [];

  // Start health server (liveness/readiness/status for worker)
  const healthServer = createHealthServer({ workerId, queues });
  healthServer.listen(config.WORKER_HEALTH_PORT, () => {
    logger.info(
      { port: config.WORKER_HEALTH_PORT },
      `Worker health server listening on :${config.WORKER_HEALTH_PORT}`
    );
  });

  // Start queue consumers: email:send + webhook:deliver (M3.1).
  const emailQueue = await startWorker();
  queues.push(emailQueue as Queue<unknown>);
  try {
    const webhookQueue = startWebhookConsumer();
    if (webhookQueue) queues.push(webhookQueue as Queue<unknown>);
  } catch (err) {
    logger.error({ err }, "Webhook consumer failed to start; email worker unaffected");
  }

  // ── Heartbeat + in-process alert evaluation ────────────────────
  // A heartbeat is how "the worker is alive but idle" is distinguished from
  // "the worker is dead" (both look like an empty queue otherwise). Alerts are
  // reported through the single error-reporting path, so a log drain — or
  // Sentry, once a DSN exists — can route them without further code.
  const heartbeatStore = redisUrl
    ? new WorkerHeartbeatStore(redisUrl, {
        ttlSeconds: Math.max(config.WORKER_HEARTBEAT_STALE_SECONDS * 2, 60),
      })
    : null;

  let alertEvaluationRunning = false;
  const tick = async () => {
    const stats = workerStatsSnapshot(workerId);
    if (heartbeatStore) {
      const wrote = await heartbeatStore.write({
        workerId,
        startedAt: stats.startedAt,
        updatedAt: new Date().toISOString(),
        processed: stats.sent + stats.failed + stats.suppressed + stats.exhausted,
        failed: stats.exhausted,
        queues: queues.map((q) => q.name),
        driver: queueDriverForThisProcess(),
      });
      recordHeartbeat(wrote);
      if (!wrote) {
        logger.warn({ workerId }, "Worker heartbeat could not be published (Redis unavailable)");
      }
    }

    if (alertEvaluationRunning) return;
    alertEvaluationRunning = true;
    try {
      const redisOk = redisUrl ? (await pingRedisUrl(redisUrl, 1500)).ok : undefined;
      const alerts = evaluateAlerts(
        {
          ...(redisOk === undefined ? {} : { redisOk }),
          exhaustedJobs: exhaustedJobs.value(),
          providerFailures: providerFailures.value(),
        },
        alertThresholdsFromEnv()
      ).filter((alert) =>
        // Queue depth, DLQ size and heartbeat staleness are evaluated centrally
        // (the API's /v1/cron/alerts sweep), where every queue is visible at
        // once. The worker reports only what only it can see.
        [
          "worker_repeated_job_failures",
          "provider_failure_sustained",
          "redis_unavailable",
        ].includes(alert.id)
      );
      for (const alert of alerts) {
        captureMessage(formatAlert(alert), {
          service: "worker",
          severity: alert.severity === "critical" ? "error" : "warning",
          fingerprint: `worker:${alert.id}`,
          ...alert.details,
        });
      }
    } finally {
      alertEvaluationRunning = false;
    }
  };

  // Stuck message detector: runs less frequently, checks for messages stuck in "queued" > 5 min
  let stuckDetectorRunning = false;
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const checkStuckMessages = async () => {
    if (stuckDetectorRunning) return;
    stuckDetectorRunning = true;
    try {
      const { getDb, emails } = await import("@calder/db");
      const { and, eq, lt } = await import("drizzle-orm");
      const db = getDb();
      const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
      const stuck = await db
        .select({ id: emails.id, projectId: emails.projectId, createdAt: emails.createdAt })
        .from(emails)
        .where(and(eq(emails.status, "queued"), lt(emails.createdAt, cutoff)))
        .limit(100);
      if (stuck.length > 0) {
        logger.warn({ count: stuck.length, oldest: stuck[stuck.length - 1]?.createdAt }, "Stuck messages detected (queued > 5 min)");
        // Log to audit for visibility
        const { auditLogs } = await import("@calder/db");
        const { randomUUID } = await import("node:crypto");
        for (const msg of stuck.slice(0, 10)) {
          await db.insert(auditLogs).values({
            id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            organizationId: "unknown", // would need project->org join
            action: "email.stuck_detected",
            targetType: "email",
            targetId: msg.id,
            metadata: { stuckSince: msg.createdAt.toISOString(), thresholdMs: STUCK_THRESHOLD_MS },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Stuck message check failed");
    } finally {
      stuckDetectorRunning = false;
    }
  };

  const heartbeatTimer = setInterval(() => {
    void tick();
  }, config.WORKER_HEARTBEAT_INTERVAL_SECONDS * 1000);
  heartbeatTimer.unref?.();

  // Stuck message detector: check every 60 seconds for messages queued > 5 min
  const stuckTimer = setInterval(() => {
    void checkStuckMessages();
  }, 60 * 1000);
  stuckTimer.unref?.();

  await tick();

  // ── Graceful shutdown ─────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, workerId }, "Shutting down worker...");
    clearInterval(heartbeatTimer);
    clearInterval(stuckTimer);
    healthServer.close();
    // Removing the heartbeat immediately is deliberate: a scaled-down worker
    // must not keep reporting healthy until its TTL expires.
    await heartbeatStore?.clear(workerId);
    heartbeatStore?.close();
    for (const queue of queues) await queue.close().catch(() => undefined);
    await flushErrorReporting();
    await errorReportingReady();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (err) => {
  logger.error({ err }, "Worker failed to start");
  await flushErrorReporting();
  process.exit(1);
});
