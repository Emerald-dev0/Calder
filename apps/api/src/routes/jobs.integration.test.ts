import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * Scheduler → processor integration through the public HTTP trigger.
 * Proves the authenticated route calls the real bounded processor and that its
 * observability contract is reachable. Does not prove any external scheduler
 * actually calls it.
 */
gate("authenticated processor trigger (live Postgres)", () => {
  let app: Awaited<ReturnType<typeof import("../app.js").createApp>>;
  let db: Awaited<ReturnType<typeof import("@calder/db").getDb>>;
  const originalSecret = process.env.QUEUE_PROCESSOR_SECRET;

  beforeAll(async () => {
    process.env.QUEUE_PROCESSOR_SECRET = `r5-secret-${Date.now()}`;
    const { createApp } = await import("../app.js");
    const { getDb } = await import("@calder/db");
    app = createApp();
    db = getDb();
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`select 1`);
  });

  afterAll(async () => {
    const { closeDb } = await import("@calder/db");
    await closeDb();
    if (originalSecret === undefined) delete process.env.QUEUE_PROCESSOR_SECRET;
    else process.env.QUEUE_PROCESSOR_SECRET = originalSecret;
  });

  it("rejects an unauthenticated or missing-secret trigger", async () => {
    const noToken = await app.request("/v1/jobs/process", { method: "POST" });
    expect(noToken.status).toBe(401);
    const wrong = await app.request("/v1/jobs/process", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status).toBe(401);

    const secret = process.env.QUEUE_PROCESSOR_SECRET;
    delete process.env.QUEUE_PROCESSOR_SECRET;
    const disabled = await app.request("/v1/jobs/process", { method: "POST" });
    expect(disabled.status).toBe(503);
    process.env.QUEUE_PROCESSOR_SECRET = secret;
  });

  it("runs the bounded processor and records a safe trigger label", async () => {
    const secret = process.env.QUEUE_PROCESSOR_SECRET!;
    const response = await app.request("/v1/jobs/process", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-calder-trigger": "scheduler",
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      runId: string;
      trigger: string;
      claimed: number;
      durationMs: number;
    };
    expect(body.trigger).toBe("scheduler");
    expect(body.runId).toMatch(/^qpr_/);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);

    const forged = await app.request("/v1/jobs/process", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-calder-trigger": "scheduler-but-actually-free-text",
      },
    });
    expect(((await forged.json()) as { trigger: string }).trigger).toBe("manual");
  });

  it("exposes pending/due/lease/retry/dead-letter and last-run observability", async () => {
    const secret = process.env.QUEUE_PROCESSOR_SECRET!;
    const response = await app.request("/v1/jobs/status", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jobs: Record<string, unknown>;
      webhooks: Record<string, unknown>;
      processor: {
        lastSuccess: unknown;
        lastFailure: unknown;
        recent: unknown[];
        schedulerMode: string;
      };
    };
    for (const key of [
      "pending",
      "duePending",
      "retrying",
      "expiredLeases",
      "deadLetter",
      "oldestPendingAgeSeconds",
      "oldestDueAgeSeconds",
    ]) {
      expect(body.jobs).toHaveProperty(key);
    }
    for (const key of ["pending", "due", "sending", "expiredLeases", "exhausted"]) {
      expect(body.webhooks).toHaveProperty(key);
    }
    expect(body.processor).toHaveProperty("lastSuccess");
    expect(body.processor).toHaveProperty("lastFailure");
    expect(Array.isArray(body.processor.recent)).toBe(true);
    expect(body.processor.schedulerMode).toBe("external-best-effort");
  });

  it("exposes dead letters and refuses to reprocess an unknown id", async () => {
    const secret = process.env.QUEUE_PROCESSOR_SECRET!;
    const list = await app.request("/v1/jobs/dead-letter", {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { jobs: unknown[]; webhookDeliveries: unknown[] };
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(Array.isArray(body.webhookDeliveries)).toBe(true);

    const missing = await app.request("/v1/jobs/dead-letter/webhooks/whd_missing/reprocess", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { requeued: boolean }).requeued).toBe(false);
  });
});
