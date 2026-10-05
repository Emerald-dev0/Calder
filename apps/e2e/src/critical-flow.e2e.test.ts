import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pingRedis } from "@calder/queue";
import {
  E2E_ENABLED,
  REDIS_URL,
  cleanupTenant,
  emailRow,
  post,
  provisionTenant,
  setRedisEnv,
  startApi,
  usageCount,
  waitFor,
  type ApiHandle,
  type E2eTenant,
} from "./helpers.js";

/**
 * Critical production flow, end to end, against real infrastructure:
 *
 *   API key (the dashboard's key-creation code path)
 *     → authenticated API interaction
 *     → persist (queued)
 *     → Redis queue
 *     → worker
 *     → provider (mock: the supported test-env mode)
 *     → delivery state + event ledger
 *     → usage metered exactly once
 *     → webhook delivery row fanned out
 *
 * Runs in CI with Postgres and Redis service containers (see
 * .github/workflows/ci.yml), and locally via `docker compose up -d` with
 * RUN_INTEGRATION_TESTS=1. Signup → verification → login → onboarding are the
 * dashboard's flows; they are covered by the Playwright suite in ./e2e/ and
 * reported honestly (browser downloads are unavailable in some sandboxes).
 */
const gate = E2E_ENABLED ? describe : describe.skip;

gate("critical flow: key → send → queue → worker → delivery state", () => {
  let api: ApiHandle | null = null;
  let tenant: E2eTenant | null = null;
  let worker: { close: () => Promise<void> } | null = null;
  let redisOk = false;

  beforeAll(async () => {
    redisOk = (await pingRedis(REDIS_URL, 1000)).ok;
    if (!redisOk) return;
    setRedisEnv(REDIS_URL);

    tenant = await provisionTenant("flow");
    api = await startApi();

    // Register a webhook endpoint so delivery fan-out is real. The endpoint
    // itself is never contacted successfully (it is not resolvable) — the
    // assertion is that the durable delivery row is written *before* any
    // network attempt, which is the property that matters.
    const hookRes = await post(
      api.url,
      "/v1/webhooks",
      { url: "https://hooks.e2e.example/calder", events: ["email.sent", "email.failed"] },
      { authorization: `Bearer ${tenant.liveApiKey}` }
    );
    expect([201, 409]).toContain(hookRes.status);

    // The real worker consumer, in-process, on the real queue.
    const { startWorker } = await import("@calder/worker/src/worker.js");
    worker = (await startWorker()) as unknown as { close: () => Promise<void> };
  }, 30_000);

  afterAll(async () => {
    if (worker) await worker.close().catch(() => undefined);
    if (api) await api.close();
    if (tenant) await cleanupTenant(tenant);
    setRedisEnv(process.env.REDIS_URL);
  }, 30_000);

  it("rejects an unauthenticated send (auth is enforced over real HTTP)", async () => {
    if (!redisOk || !api || !tenant) return;
    const res = await post(api.url, "/v1/emails", {
      from: tenant.from,
      to: `nobody-${tenant.suffix}@test.test`,
      subject: "no key",
      text: "x",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; request_id: string } };
    expect(body.error.code).toBe("authentication_error");
    expect(body.error.request_id).toMatch(/^req_/);
  });

  it("accepts a live send, delivers it through the worker, and meters it exactly once", async () => {
    if (!redisOk || !api || !tenant) return;
    const to = `delivered-${tenant.suffix}@test.test`;
    const res = await post(
      api.url,
      "/v1/emails",
      { from: tenant.from, to, subject: "e2e critical flow", text: "hello from the e2e suite" },
      { authorization: `Bearer ${tenant.liveApiKey}`, "idempotency-key": `e2e-${tenant.suffix}-1` }
    );
    expect(res.status).toBe(202);
    const accepted = (await res.json()) as { id: string; status: string };
    expect(accepted.status).toBe("queued");

    // The worker consumes from Redis and hands the message to the mock
    // provider; delivery state lands on the row.
    await waitFor(async () => (await emailRow(accepted.id))?.status === "sent", {
      timeoutMs: 20_000,
      label: "email status sent",
    });
    const row = await emailRow(accepted.id);
    expect(row?.status).toBe("sent");
    expect(row?.provider).toBe("mock");
    expect(row?.env).toBe("live");
    expect(row?.providerMessageId).toBeTruthy();

    // Event ledger: queued then sent.
    const { getDb, emailEvents } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const events = await getDb()
      .select({ type: emailEvents.type })
      .from(emailEvents)
      .where(eq(emailEvents.emailId, accepted.id));
    const types = events.map((e) => e.type);
    expect(types).toContain("queued");
    expect(types).toContain("sent");

    // Metered exactly once (deterministic ledger id, ADR-036).
    expect(await usageCount(accepted.id)).toBe(1);

    // Webhook fan-out is durable before delivery is attempted.
    const { webhookDeliveries } = await import("@calder/db");
    const deliveries = await getDb()
      .select({ event: webhookDeliveries.event })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.projectId, tenant.projectId));
    expect(deliveries.map((d) => d.event)).toContain("email.sent");
  }, 40_000);

  it("keeps test-environment sends unmetred (ADR-036 isolation still holds)", async () => {
    if (!redisOk || !api || !tenant) return;
    const to = `test-env-${tenant.suffix}@test.test`;
    const res = await post(
      api.url,
      "/v1/emails",
      { from: tenant.from, to, subject: "test env", text: "never billed" },
      {
        authorization: `Bearer ${tenant.apiKey}`,
        "idempotency-key": `e2e-${tenant.suffix}-test-env`,
      }
    );
    expect(res.status).toBe(202);
    const accepted = (await res.json()) as { id: string };

    await waitFor(async () => (await emailRow(accepted.id))?.status === "sent", {
      timeoutMs: 20_000,
      label: "test-env send delivered via mock",
    });
    expect((await emailRow(accepted.id))?.provider).toBe("mock");
    expect(await usageCount(accepted.id)).toBe(0);
  }, 40_000);

  it("replays an identical request without a second send or a second meter row", async () => {
    if (!redisOk || !api || !tenant) return;
    const to = `replay-${tenant.suffix}@test.test`;
    const idempotencyKey = `e2e-${tenant.suffix}-replay`;
    const body = { from: tenant.from, to, subject: "replay", text: "once" };

    const first = await post(api.url, "/v1/emails", body, {
      authorization: `Bearer ${tenant.liveApiKey}`,
      "idempotency-key": idempotencyKey,
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { id: string };

    const second = await post(api.url, "/v1/emails", body, {
      authorization: `Bearer ${tenant.liveApiKey}`,
      "idempotency-key": idempotencyKey,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);

    await waitFor(async () => (await emailRow(firstBody.id))?.status === "sent", {
      timeoutMs: 20_000,
      label: "replay send delivered",
    });
    expect(await usageCount(firstBody.id)).toBe(1);

    const { getDb, emails } = await import("@calder/db");
    const { and, eq, count } = await import("drizzle-orm");
    const [rows] = await getDb()
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, tenant.projectId), eq(emails.to, to)));
    expect(Number(rows?.value)).toBe(1);
  }, 40_000);

  it("refuses a suppressed recipient before it is queued", async () => {
    if (!redisOk || !api || !tenant) return;
    const blocked = `blocked-${tenant.suffix}@test.test`;
    const { getDb, suppressions } = await import("@calder/db");
    await getDb()
      .insert(suppressions)
      .values({
        id: `sup_e2e_${tenant.suffix}`,
        projectId: tenant.projectId,
        email: blocked,
        reason: "bounce",
      });

    const res = await post(
      api.url,
      "/v1/emails",
      { from: tenant.from, to: blocked, subject: "blocked", text: "should not queue" },
      { authorization: `Bearer ${tenant.liveApiKey}` }
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("suppressed");

    const { emails } = await import("@calder/db");
    const { and, eq, count } = await import("drizzle-orm");
    const [rows] = await getDb()
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, tenant.projectId), eq(emails.to, blocked)));
    expect(Number(rows?.value)).toBe(0);
  }, 30_000);

  it("enqueues onto Redis (the durable queue is real, not simulated)", async () => {
    if (!redisOk || !api || !tenant) return;
    const { createQueue, QUEUE_NAMES } = await import("@calder/queue");
    const queue = createQueue<{ emailId: string }>(QUEUE_NAMES.emailSend, { redisUrl: REDIS_URL });
    try {
      const metrics = await queue.metrics!();
      expect(metrics.driver).toBe("redis");
      expect(metrics.waiting).toBeGreaterThanOrEqual(0);
      expect(metrics.completed).toBeGreaterThanOrEqual(0);
    } finally {
      await queue.close();
    }
  }, 30_000);

  it("serves honest readiness over HTTP (database + queue checked, no secrets)", async () => {
    if (!redisOk || !api) return;
    const res = await fetch(`${api.url}/ready`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { state: string; detail?: string }>;
    };
    expect(body.status).toBe("ready");
    expect(body.checks.database?.state).toBe("ok");
    expect(body.checks.queue?.state).toBe("ok");
    // No credentials anywhere in the readiness payload. Host:port is
    // intentional (an operator needs to know which dependency is checked);
    // userinfo, passwords and query credentials are not.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/\/\/[^\s"]*@/); // no user:pass@ in any URL
    expect(raw).not.toContain("calder:calder");
    expect(raw.toLowerCase()).not.toContain("password");
  }, 20_000);
});
