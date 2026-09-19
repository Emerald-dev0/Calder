import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

// The secret store is AES-256-GCM keyed from AUTH_SECRET.
process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 0, M0.3 webhook secret-once:
 * - POST returns the raw signing secret exactly once in the create response
 * - the stored value is AES-256-GCM ciphertext that decrypts back to it
 * - GET never exposes any secret material (raw or ciphertext)
 */
gate("webhook secret-once (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, webhooks } =
    await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { decryptSecret } = await import("@calder/auth");
  const { WEBHOOK_SECRET_CONTEXT } = await import("../lib/webhook-secrets.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_wh_${suffix}`;
  const projId = `proj_wh_${suffix}`;
  const userId = `usr_wh_${suffix}`;
  const keySecret = `calder_test_wh_${suffix}_${"k".repeat(12)}`;

  const app = createApp();

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `wh-user-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "WH Test", slug: `wh-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_wh_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(keySecret, {
      apiKeyId: `key_wh_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("create returns the secret once, stores ciphertext that round-trips", async () => {
    if (!(await reachable())) return;
    const res = await app.request("/v1/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keySecret}`,
      },
      body: JSON.stringify({ url: "https://example.com/hook", events: ["email.sent"] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.id).toMatch(/^wh_/);
    expect(typeof body.data.secret).toBe("string");
    expect(body.data.secret as string).toMatch(/^whsec_[0-9a-f]{48}$/);

    // Stored value: ciphertext that decrypts back to the exact secret shown.
    const db = getDb();
    const [row] = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, body.data.id as string))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.secret).not.toBe(body.data.secret);
    expect(decryptSecret(row!.secret, WEBHOOK_SECRET_CONTEXT)).toBe(body.data.secret);
  });

  it("GET never returns secret material", async () => {
    if (!(await reachable())) return;
    const res = await app.request("/v1/webhooks", {
      headers: { authorization: `Bearer ${keySecret}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    for (const row of body.data) {
      expect("secret" in row).toBe(false);
      expect(JSON.stringify(row)).not.toContain("whsec_");
    }
  });
});
