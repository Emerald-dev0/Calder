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
 * What happens when Redis disappears.
 *
 * The design under test is deliberate and documented in docs/OPERATIONS.md:
 * Postgres holds the durable record, Redis is the delivery wake-up channel, and
 * the scheduled/triggered drain is the backstop. So the required behaviour is:
 *
 *   - the send is still ACCEPTED (202) and the row stays `queued` — nothing is
 *     dropped, nothing is silently "delivered";
 *   - the enqueue failure is visible (counter + classification), not swallowed;
 *   - the email is NOT metered while it has not been accepted by a provider;
 *   - once delivery runs, it is metered exactly once.
 *
 * The "Redis is down" case is simulated by pointing the process at a closed
 * port: the code path (connection refused / timeout on enqueue) is identical
 * to Redis being unreachable in production.
 */
const gate = E2E_ENABLED ? describe : describe.skip;

const DEAD_REDIS = "redis://127.0.0.1:6399";

gate("Redis unavailable: durable acceptance, no silent loss", () => {
  let api: ApiHandle | null = null;
  let tenant: E2eTenant | null = null;
  let realRedisOk = false;

  beforeAll(async () => {
    realRedisOk = (await pingRedis(REDIS_URL, 1000)).ok;
    if (!realRedisOk) return;
    tenant = await provisionTenant("redisdown");
    setRedisEnv(DEAD_REDIS);
    api = await startApi();
  }, 30_000);

  afterAll(async () => {
    if (api) await api.close();
    setRedisEnv(process.env.REDIS_URL);
    if (tenant) await cleanupTenant(tenant);
  }, 30_000);

  it("accepts the send durably, keeps it queued, and does not meter it", async () => {
    if (!realRedisOk || !api || !tenant) return;
    const to = `redis-down-${tenant.suffix}@test.test`;
    const res = await post(
      api.url,
      "/v1/emails",
      { from: tenant.from, to, subject: "redis down", text: "still accepted" },
      { authorization: `Bearer ${tenant.liveApiKey}`, "idempotency-key": `rd-${tenant.suffix}` }
    );

    // 202: the *send* was accepted onto durable storage. Delivery is pending.
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("queued");

    const row = await emailRow(body.id);
    expect(row?.status).toBe("queued");
    // Nothing has been handed to a provider, so nothing may be billed.
    expect(await usageCount(body.id)).toBe(0);
  }, 40_000);

  it("the enqueue failure is counted, not swallowed", async () => {
    if (!realRedisOk || !api || !tenant) return;
    const { queueEnqueueFailures } = await import("@calder/observability");
    // The counter lives in the API process, which is this process.
    await waitFor(() => queueEnqueueFailures.value() > 0, {
      timeoutMs: 10_000,
      label: "enqueue failure counter",
    });
    expect(queueEnqueueFailures.value()).toBeGreaterThan(0);
  }, 20_000);

  it("delivers the queued email once Redis is reachable again (drain is the backstop)", async () => {
    if (!realRedisOk || !tenant) return;
    // Find the row we left queued.
    const { getDb, emails } = await import("@calder/db");
    const { and, eq, count } = await import("drizzle-orm");
    const [row] = await getDb()
      .select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.projectId, tenant.projectId), eq(emails.status, "queued")))
      .limit(1);
    expect(row?.id).toBeTruthy();

    // The drain is Postgres-backed: it does not need Redis at all.
    const { drainPendingEmails } = await import("@calder/api/src/lib/drain.js");
    const result = await drainPendingEmails(getDb());
    expect(result.ok).toBe(true);

    await waitFor(async () => (await emailRow(row!.id))?.status === "sent", {
      timeoutMs: 20_000,
      label: "queued email delivered by drain",
    });
    expect(await usageCount(row!.id)).toBe(1);

    const [pending] = await getDb()
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, tenant.projectId), eq(emails.status, "queued")));
    expect(Number(pending?.value)).toBe(0);
  }, 40_000);

  it("refuses to construct a queue without Redis in a hosted environment", async () => {
    const { createQueue, QueueConfigurationError } = await import("@calder/queue");
    const { resetConfig } = await import("@calder/config");
    const original = { ...process.env };
    try {
      process.env.NODE_ENV = "production";
      process.env.CALDER_ENV = "production";
      delete process.env.REDIS_URL;
      resetConfig();
      expect(() => createQueue("e2e:hosted")).toThrow(QueueConfigurationError);
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in original)) delete process.env[key];
      }
      Object.assign(process.env, original);
      resetConfig();
    }
  });
});
