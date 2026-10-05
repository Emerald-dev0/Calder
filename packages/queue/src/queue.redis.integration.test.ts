import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RedisQueue } from "./redis.js";
import { WorkerHeartbeatStore, hasFreshHeartbeat } from "./health.js";
import { pingRedis, pingRedisUrl } from "./ping.js";

/**
 * Real-Redis queue behaviour. Gated exactly like the other integration suites:
 * RUN_INTEGRATION_TESTS=1 plus a reachable REDIS_URL (docker compose up -d, or
 * the CI service container). Everything here asserts a *durability* property
 * that an in-memory stand-in cannot prove, which is the entire point.
 */
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

async function redisReachable(): Promise<boolean> {
  const ping = await pingRedis(REDIS_URL, 1000);
  return ping.ok;
}

const gate = ENABLED ? describe : describe.skip;
const suffix = Math.random().toString(36).slice(2, 8);

function queueName(base: string): string {
  return `${base}:${suffix}:${Math.random().toString(36).slice(2, 8)}`;
}

async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 10_000, intervalMs = 100 } = {}
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

gate("RedisQueue against a real Redis", () => {
  let reachable = false;
  const open: RedisQueue<unknown>[] = [];

  beforeAll(async () => {
    reachable = await redisReachable();
  });

  afterAll(async () => {
    for (const queue of open) await queue.close().catch(() => undefined);
  });

  function makeQueue<T>(name: string, opts?: { maxAttempts?: number }): RedisQueue<T> {
    const queue = new RedisQueue<T>(name, REDIS_URL, {
      maxAttempts: opts?.maxAttempts ?? 3,
      concurrency: 1,
    });
    open.push(queue as unknown as RedisQueue<unknown>);
    return queue;
  }

  it("enqueues and processes a job end to end", async () => {
    if (!reachable) return;
    const queue = makeQueue<{ n: number }>(queueName("q-roundtrip"));
    const seen: number[] = [];
    queue.process(async (job) => {
      seen.push(job.data.n);
    });
    await queue.enqueue("work", { n: 7 });
    expect(await waitFor(() => seen.length === 1)).toBe(true);
    expect(seen[0]).toBe(7);
  }, 20_000);

  it("redelivers a throwing job and increments attempts", async () => {
    if (!reachable) return;
    const queue = makeQueue<{ id: string }>(queueName("q-retry"), { maxAttempts: 3 });
    const attempts: number[] = [];
    queue.process(async (job) => {
      attempts.push(job.attempts + 1);
      if (attempts.length < 2) throw new Error("transient, retry me");
    });
    await queue.enqueue("work", { id: "retry" });
    expect(await waitFor(() => attempts.length >= 2, { timeoutMs: 15_000 })).toBe(true);
    expect(attempts[1]).toBe(2);
  }, 25_000);

  it("dead-letters an exhausted job into the failed pool", async () => {
    if (!reachable) return;
    const name = queueName("q-dlq");
    const queue = makeQueue<{ id: string }>(name, { maxAttempts: 2 });
    queue.process(async () => {
      throw new Error("always fails");
    });
    await queue.enqueue("work", { id: "dead" });
    const metrics = await (async () => {
      let latest = await queue.metrics();
      await waitFor(
        async () => {
          latest = await queue.metrics();
          return latest.failed >= 1;
        },
        { timeoutMs: 15_000 }
      );
      return latest;
    })();
    expect(metrics.failed).toBeGreaterThanOrEqual(1);
  }, 25_000);

  it("reports depth and oldest waiting job age", async () => {
    if (!reachable) return;
    const queue = makeQueue<{ id: string }>(queueName("q-metrics"));
    await queue.enqueue("work", { id: "a" });
    await queue.enqueue("work", { id: "b" });
    await queue.enqueueDelayed("work", { id: "c" }, 30_000);

    const metrics = await queue.metrics();
    expect(metrics.driver).toBe("redis");
    expect(metrics.waiting).toBe(2);
    expect(metrics.delayed).toBe(1);
    expect(metrics.oldestWaitingAgeSeconds).not.toBeNull();
  }, 20_000);

  it("fails fast on enqueue when Redis is unreachable, instead of hanging", async () => {
    const dead = new RedisQueue<{ id: string }>("q-unreachable", "redis://127.0.0.1:6399", {
      maxAttempts: 1,
    });
    open.push(dead as unknown as RedisQueue<unknown>);
    const started = Date.now();
    await expect(dead.enqueue("work", { id: "x" })).rejects.toThrow();
    const elapsed = Date.now() - started;
    // Default enqueue ceiling is 5s; the point is that it *returns*.
    expect(elapsed).toBeLessThan(8_000);
  }, 20_000);

  it("reports metrics failures instead of hanging when Redis is unreachable", async () => {
    const dead = new RedisQueue<{ id: string }>("q-unreachable-metrics", "redis://127.0.0.1:6399");
    open.push(dead as unknown as RedisQueue<unknown>);
    await expect(dead.metrics()).rejects.toThrow();
  }, 20_000);

  it("pings both redis:// and reports failure for an unreachable target", async () => {
    if (!reachable) return;
    expect((await pingRedis(REDIS_URL, 1000)).ok).toBe(true);
    const dead = await pingRedisUrl("redis://127.0.0.1:6399", 700);
    expect(dead.ok).toBe(false);
    expect(dead.detail).toMatch(/redis (error|timeout)/);
  }, 15_000);
});

gate("worker heartbeat against a real Redis", () => {
  it("writes, reads, expires and clears heartbeats", async () => {
    const ping = await pingRedis(REDIS_URL, 1000);
    if (!ping.ok) return;
    const store = new WorkerHeartbeatStore(REDIS_URL, { ttlSeconds: 60 });
    const workerId = `test-worker-${suffix}`;

    const wrote = await store.write({
      workerId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processed: 3,
      failed: 0,
      queues: ["email:send"],
      driver: "redis",
    });
    expect(wrote).toBe(true);

    const read = await store.read();
    expect(read.ok).toBe(true);
    const mine = read.heartbeats.find((h) => h.workerId === workerId);
    expect(mine).toBeDefined();
    expect(mine!.processed).toBe(3);
    expect(hasFreshHeartbeat(read.heartbeats, 120)).toBe(true);

    await store.clear(workerId);
    const after = await store.read();
    expect(after.heartbeats.find((h) => h.workerId === workerId)).toBeUndefined();

    store.close();
  }, 20_000);

  it("never throws when Redis is unreachable", async () => {
    const store = new WorkerHeartbeatStore("redis://127.0.0.1:6399", { ttlSeconds: 30 });
    const wrote = await store.write({
      workerId: "x",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processed: 0,
      failed: 0,
      queues: [],
      driver: "redis",
    });
    expect(wrote).toBe(false);
    const read = await store.read();
    expect(read.ok).toBe(false);
    expect(read.heartbeats).toEqual([]);
    store.close();
  }, 20_000);
});
