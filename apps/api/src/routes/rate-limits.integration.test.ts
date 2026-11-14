import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and credential operations are metered (Stage 3.5).
 *
 * Only writes were limited before, so one key could walk `GET /v1/emails` and
 * mint API keys as fast as the process allowed. The assertions here are about
 * the wiring — the right preset on the right route, and a 429 a client can act
 * on — not about hitting the ceiling, which would mean 600 requests.
 */
gate("read and key-operation limits (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, cleanupSuiteOrg } =
    await import("@calder/db");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { setRateLimiter } = await import("@calder/rate-limit");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_rl_${suffix}`;
  const projId = `proj_rl_${suffix}`;
  const userId = `usr_rl_${suffix}`;
  const key = `calder_test_rl_${suffix}_${"k".repeat(12)}`;

  const app = createApp();
  const get = (path: string, k = key) =>
    app.request(path, { headers: { authorization: `Bearer ${k}` } });

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `rl-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Limits", slug: `rl-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_rl_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(key, {
      apiKeyId: `key_rl_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("advertises the remaining read budget on a list call", async () => {
    if (!(await reachable())) return;
    const res = await get("/v1/emails");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("600");
    expect(res.headers.get("x-ratelimit-remaining")).toMatch(/^\d+$/);
  });

  it("meters every documented read surface, and reports the same limit on each", async () => {
    if (!(await reachable())) return;
    for (const path of [
      "/v1/emails",
      "/v1/domains",
      "/v1/suppressions",
      "/v1/templates",
      "/v1/keys",
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-ratelimit-limit"), path).toBe("600");
    }
  });

  it("gives a refused read a Retry-After the client can honour", async () => {
    if (!(await reachable())) return;
    const original = await import("@calder/rate-limit");
    const previous = original.getRateLimiter();
    setRateLimiter({
      async check() {
        return {
          allowed: false,
          limit: 600,
          remaining: 0,
          resetAt: new Date(Date.now() + 12_000),
          retryAfterMs: 12_000,
        };
      },
      async reset() {},
    });
    try {
      const res = await get("/v1/emails");
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("12");
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("rate_limit_error");
    } finally {
      setRateLimiter(previous);
    }
  });
});
