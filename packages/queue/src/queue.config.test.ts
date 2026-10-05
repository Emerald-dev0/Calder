import { describe, it, expect, afterEach } from "vitest";
import { resetConfig } from "@calder/config";
import {
  createQueue,
  resetSharedQueues,
  InMemoryQueue,
  QueueConfigurationError,
  redisRequiredMessage,
  queueDriverForThisProcess,
} from "./index.js";

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetSharedQueues();
}

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetConfig();
  resetSharedQueues();
});

describe("queue driver enforcement", () => {
  it("allows an in-process queue in development without REDIS_URL", () => {
    setEnv({ NODE_ENV: "development", CALDER_ENV: undefined, REDIS_URL: undefined });
    const queue = createQueue("dev:test", { maxAttempts: 1 });
    expect(queue).toBeInstanceOf(InMemoryQueue);
    expect(queue.driver).toBe("memory");
    expect(queueDriverForThisProcess()).toBe("memory");
  });

  it("allows an in-process queue in tests without REDIS_URL", () => {
    setEnv({ NODE_ENV: "test", CALDER_ENV: undefined, REDIS_URL: undefined });
    expect(createQueue("t:test").driver).toBe("memory");
  });

  it("refuses to construct an in-process queue in production", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: undefined, REDIS_URL: undefined });
    expect(() => createQueue("email:send")).toThrow(QueueConfigurationError);
    expect(() => createQueue("email:send")).toThrow(/without REDIS_URL in the production/);
  });

  it("refuses to construct an in-process queue in staging", () => {
    setEnv({ NODE_ENV: "production", CALDER_ENV: "staging", REDIS_URL: undefined });
    expect(() => createQueue("email:send")).toThrow(/without REDIS_URL in the staging/);
  });

  it("uses Redis when REDIS_URL is present, even in development", () => {
    setEnv({ NODE_ENV: "development", REDIS_URL: "redis://127.0.0.1:6399" });
    const queue = createQueue("dev:redis", { redisUrl: "redis://127.0.0.1:6399" });
    expect(queue.driver).toBe("redis");
  });

  it("names the queue and the environment in the failure message", () => {
    setEnv({ NODE_ENV: "production", REDIS_URL: undefined });
    expect(redisRequiredMessage("webhook:deliver")).toMatch(/webhook:deliver/);
    expect(redisRequiredMessage("webhook:deliver")).toMatch(/production/);
  });
});

describe("InMemoryQueue metrics", () => {
  it("reports waiting, delayed and oldest age without a backend", async () => {
    const queue = new InMemoryQueue<string>("metrics:test", { maxAttempts: 1 });
    await queue.enqueue("a", "one");
    await queue.enqueueDelayed("b", "later", 60_000);

    const metrics = await queue.metrics();
    expect(metrics.driver).toBe("memory");
    expect(metrics.waiting).toBe(1);
    expect(metrics.delayed).toBe(1);
    expect(metrics.oldestWaitingAgeSeconds).toBeTypeOf("number");
    expect(metrics.oldestWaitingAgeSeconds!).toBeGreaterThanOrEqual(0);

    await queue.close();
  });

  it("reports a null oldest age for an empty queue", async () => {
    const queue = new InMemoryQueue<string>("empty:test");
    expect((await queue.metrics()).oldestWaitingAgeSeconds).toBeNull();
  });
});
