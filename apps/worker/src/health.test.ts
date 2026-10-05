import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { resetConfig } from "@calder/config";
import { createQueue, pingRedis, QUEUE_NAMES, resetSharedQueues } from "@calder/queue";
import { createHealthServer } from "./health.js";
import {
  recordHeartbeat,
  recordJobOutcome,
  recordRedisError,
  resetWorkerStats,
} from "./worker-stats.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const DEAD_REDIS = "redis://127.0.0.1:6399";

process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function startHealthServer(redisUrl: string | undefined): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  if (redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrl;
  resetConfig();
  resetSharedQueues();

  const server: Server = createHealthServer({ workerId: "test-worker", queues: [] });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

gate("worker health endpoints", () => {
  let handle: { base: string; close: () => Promise<void> } | null = null;
  let redisOk = false;

  beforeAll(async () => {
    resetWorkerStats();
    redisOk = (await pingRedis(REDIS_URL, 1000)).ok;
  }, 20_000);

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it("liveness stays 200 even when dependencies are unhealthy", async () => {
    if (!redisOk) return;
    handle = await startHealthServer(DEAD_REDIS);
    const res = await fetch(`${handle.base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("worker");
  }, 20_000);

  it("readiness reports 503 with the failing dependency named when Redis is down", async () => {
    if (!redisOk) return;
    handle = await startHealthServer(DEAD_REDIS);
    const res = await fetch(`${handle.base}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { state: string; detail?: string }>;
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.redis?.state).toBe("degraded");
    expect(body.checks.database?.state).toBe("ok");
    // Credentials never appear in a health payload.
    expect(JSON.stringify(body)).not.toMatch(/:\/\/[^\s"]*@/);
  }, 30_000);

  it("readiness reports 200 when Redis, the database and a fresh heartbeat are present", async () => {
    if (!redisOk) return;
    if (handle) await handle.close();
    handle = await startHealthServer(REDIS_URL);
    // Mirror what the worker process does on its first tick: publish a
    // heartbeat, then report readiness.
    const { WorkerHeartbeatStore } = await import("@calder/queue");
    const store = new WorkerHeartbeatStore(REDIS_URL, { ttlSeconds: 120 });
    const wrote = await store.write({
      workerId: "test-worker",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processed: 0,
      failed: 0,
      queues: [],
      driver: "redis",
    });
    store.close();
    expect(wrote).toBe(true);
    recordHeartbeat(true);

    const res = await fetch(`${handle.base}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { state: string }>;
    };
    expect(body.status).toBe("ready");
    expect(body.checks.queue_driver?.state).toBe("ok");
    expect(body.checks.redis?.state).toBe("ok");
    expect(body.checks.heartbeat?.state).toBe("ok");
  }, 30_000);

  it("readiness reports 503 when the worker has never published a heartbeat", async () => {
    if (!redisOk) return;
    if (handle) await handle.close();
    handle = await startHealthServer(REDIS_URL);
    resetWorkerStats();
    const res = await fetch(`${handle.base}/ready`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      checks: Record<string, { state: string; detail?: string }>;
    };
    expect(body.checks.heartbeat?.state).toBe("degraded");
    expect(body.checks.heartbeat?.detail).toMatch(/never been published/);
  }, 30_000);

  it("status exposes job counters, queue metrics and alerts for operators", async () => {
    if (!redisOk) return;
    if (handle) await handle.close();
    resetWorkerStats();
    const queue = createQueue(QUEUE_NAMES.emailSend, { redisUrl: REDIS_URL });
    recordJobOutcome("sent", 42);
    recordJobOutcome("exhausted", 7);
    recordRedisError(new Error("ECONNRESET"));

    const server = createHealthServer({ workerId: "test-worker", queues: [queue] });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        stats: { sent: number; exhausted: number; redisErrors: number };
        queues: Array<{ name: string; driver: string }>;
        alerts: Array<{ id: string }>;
        unavailable: Record<string, string>;
      };
      expect(body.stats.sent).toBe(1);
      expect(body.stats.exhausted).toBe(1);
      expect(body.stats.redisErrors).toBe(1);
      expect(body.queues[0]?.driver).toBe("redis");
      // The Redis error is not itself an alert (unavailability is the signal),
      // but it is visible in the payload rather than swallowed.
      expect(Array.isArray(body.alerts)).toBe(true);
    } finally {
      await queue.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);
});

gate("in-process alert evaluation", () => {
  it("raises no alerts on a healthy, idle worker", async () => {
    const { evaluateAlerts, alertThresholdsFromEnv } = await import("@calder/observability");
    const thresholds = alertThresholdsFromEnv();
    const alerts = evaluateAlerts({ exhaustedJobs: 0 }, thresholds);
    expect(alerts).toEqual([]);
  });

  it("raises repeated-job-failures once the threshold is crossed", async () => {
    const { evaluateAlerts, alertThresholdsFromEnv } = await import("@calder/observability");
    const thresholds = alertThresholdsFromEnv();
    const alerts = evaluateAlerts({ exhaustedJobs: thresholds.workerJobFailureWarn }, thresholds);
    expect(alerts.map((a) => a.id)).toContain("worker_repeated_job_failures");
  });
});
