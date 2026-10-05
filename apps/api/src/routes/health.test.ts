import { describe, it, expect, afterEach } from "vitest";
import { resetConfig } from "@calder/config";
import { resetSharedQueues } from "@calder/queue";
import { createApp } from "../app.js";

const ORIGINAL = { ...process.env };
const DEAD_REDIS = "redis://127.0.0.1:6399";

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetSharedQueues();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetConfig();
  resetSharedQueues();
});

const app = createApp();

describe("liveness", () => {
  it("answers without touching dependencies", async () => {
    setEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://dead:dead@127.0.0.1:1/x" });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: string };
    expect(body.status).toBe("ok");
    expect(body.checks).toBe("liveness only");
  });
});

describe("readiness", () => {
  it("is ready in development/test with an in-process queue", async () => {
    setEnv({ NODE_ENV: "test", REDIS_URL: undefined });
    const res = await app.request("/ready");
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { state: string; detail?: string }>;
      required: string[];
    };
    expect(res.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.checks.queue?.state).toBe("skipped");
    expect(body.checks.queue?.detail).toMatch(/REDIS_URL unset/);
    expect(body.required).toContain("database");
  });

  it("refuses to be ready in staging/production without REDIS_URL", async () => {
    setEnv({
      NODE_ENV: "production",
      CALDER_ENV: "staging",
      REDIS_URL: undefined,
      AWS_ACCESS_KEY_ID: undefined,
    });
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { state: string; detail?: string }>;
    };
    expect(body.status).toBe("degraded");
    expect(body.checks.queue?.state).toBe("degraded");
    expect(body.checks.queue?.detail).toMatch(/REDIS_URL is required in staging/);
  });

  it("refuses to be ready when Redis is unreachable", async () => {
    setEnv({ NODE_ENV: "test", REDIS_URL: DEAD_REDIS, AWS_ACCESS_KEY_ID: undefined });
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      checks: Record<string, { state: string; detail?: string }>;
    };
    expect(body.checks.queue?.state).toBe("degraded");
  });

  it("never leaks credentials, connection strings or secrets", async () => {
    setEnv({
      NODE_ENV: "test",
      REDIS_URL: "redis://:supersecret@127.0.0.1:6399",
      DATABASE_URL: "postgresql://user:dbpassword@127.0.0.1:1/none",
      SENTRY_DSN: "https://key@sentry.example/123",
    });
    const res = await app.request("/ready");
    const raw = await res.text();
    expect(raw).not.toContain("supersecret");
    expect(raw).not.toContain("dbpassword");
    expect(raw).not.toMatch(/:\/\/[^\s"]*@/);
    expect(raw).not.toContain("sentry.example"); // DSN value never echoed
  });
});

describe("alerts sweep", () => {
  it("refuses requests without the cron secret", async () => {
    setEnv({ NODE_ENV: "test", CRON_SECRET: "test-cron-secret" });
    const res = await app.request("/v1/cron/alerts");
    expect(res.status).toBe(401);
  });

  it("reports Redis unavailability as a critical alert (503 for monitors)", async () => {
    setEnv({
      NODE_ENV: "test",
      CRON_SECRET: "test-cron-secret",
      REDIS_URL: DEAD_REDIS,
    });
    const res = await app.request("/v1/cron/alerts", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    // 503 is deliberate: a monitor pointed at this URL pages without parsing JSON.
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      ok: boolean;
      alerts: Array<{ id: string; severity: string; summary: string }>;
      signals: Record<string, unknown>;
      unavailable: Record<string, string>;
    };
    expect(body.ok).toBe(false);
    expect(body.alerts.map((a) => a.id)).toContain("redis_unavailable");
    expect(body.alerts.find((a) => a.id === "redis_unavailable")?.severity).toBe("critical");
    expect(body.unavailable.redis ?? body.unavailable.worker).toBeTruthy();
  }, 30_000);

  it("raises no alerts when the counters are clean and dependencies are healthy", async () => {
    const { pingRedis } = await import("@calder/queue");
    const ok = (await pingRedis(ORIGINAL.REDIS_URL ?? "redis://127.0.0.1:6379", 1000)).ok;
    if (!ok) return;
    setEnv({
      NODE_ENV: "test",
      CRON_SECRET: "test-cron-secret",
      REDIS_URL: ORIGINAL.REDIS_URL ?? "redis://127.0.0.1:6379",
      // This process runs no worker; a serverless deploy declares that with
      // WORKER_EXPECTED=false so "worker not processing" is not a false alarm.
      WORKER_EXPECTED: "false",
    });

    // This suite deliberately exercises slow failure paths (10s Redis
    // timeouts). Those samples are real, but they are *this test's* traffic,
    // not a production signal, so clear them before asserting.
    const { apiRequestMetrics } = await import("@calder/observability");
    apiRequestMetrics.reset();

    const res = await app.request("/v1/cron/alerts", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      alerts: Array<{ id: string }>;
      signals: Record<string, unknown>;
    };

    // The dev database is shared with other suites that legitimately leave
    // queued test emails behind (nothing drains them), so the durable
    // queued-email rule may fire. Nothing else may.
    const unexpected = body.alerts.map((a) => a.id).filter((id) => id !== "queued_email_age");
    expect(unexpected).toEqual([]);
    expect(body.signals.databaseOk).toBe(true);
    expect(body.signals.redisOk).toBe(true);
  }, 30_000);
});
