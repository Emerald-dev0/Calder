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
 * The developer journey, in the order a platform team lives it: prove the
 * project works, mint a key for the app, give the CI/worker a narrower key,
 * rotate one out without downtime.
 *
 * Every other suite authenticates with an in-memory dev key
 * (registerDevKey), which bypasses the real credential path entirely. These
 * tests use keys minted through POST /v1/keys — persisted, hashed, looked up
 * per request — so the thing a customer actually holds is exercised:
 * hashing, scope enforcement, revocation, and the one-time secret handoff.
 */
gate("developer journey: credentials a platform actually holds", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, emails } =
    await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_jrn_${suffix}`;
  const projId = `proj_jrn_${suffix}`;
  const userId = `usr_jrn_${suffix}`;
  const bootstrapKey = `calder_test_jrn_${suffix}`;
  const from = `journey-${suffix}@test.test`;

  const app = createApp();

  const call = (key: string, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(init.headers ?? {}),
      },
    });

  const send = (key: string, to: string) =>
    call(key, "/v1/emails", {
      method: "POST",
      body: JSON.stringify({ from, to, subject: "journey", text: "hello" }),
    });

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `jrn-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Journey", slug: `jrn-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(bootstrapKey, {
      apiKeyId: `key_jrn_boot_${suffix}`,
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

  let appKey = "";
  let appKeyId = "";

  it("mints an application key and hands over the secret exactly once", async () => {
    const res = await call(bootstrapKey, "/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name: "production app", env: "test", scope: "full" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; secret: string; prefix: string; env: string; warning: string };
    };
    appKey = body.data.secret;
    appKeyId = body.data.id;

    // Secret keys are calder_sk_<env>_… per docs/API.md; publishable keys
    // use calder_pk_. The environment is part of the credential.
    expect(appKey).toMatch(/^calder_sk_test_/);
    expect(body.data.prefix).toMatch(/^calder_sk_test_.*\.\.\.$/);
    expect(body.data.env).toBe("test");
    expect(body.data.warning).toMatch(/never shown again/i);

    // Listing must never leak the secret or the stored hash.
    const list = await call(bootstrapKey, "/v1/keys");
    const listed = (await list.json()) as { data: Record<string, unknown>[] };
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(appKey);
    expect(serialized).not.toContain("keyHash");
    expect(serialized).not.toContain("key_hash");
  });

  it("the minted key authenticates (hashed storage, per-request lookup) and sends", async () => {
    const res = await send(appKey, `first-${suffix}@test.test`);
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    const [row] = await getDb().select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.projectId).toBe(projId);
    expect(row?.env).toBe("test");
  });

  it("enforces scope: a send-only key cannot manage keys or read email content", async () => {
    const minted = await call(bootstrapKey, "/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name: "ci worker", env: "test", scope: "send" }),
    });
    expect(minted.status).toBe(201);
    const { data } = (await minted.json()) as { data: { secret: string } };

    // It can send…
    expect((await send(data.secret, `scoped-${suffix}@test.test`)).status).toBe(202);
    // …but key management is refused with the reason, not a blank 403.
    const denied = await call(data.secret, "/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name: "escalate", env: "test", scope: "full" }),
    });
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as {
      error: { code: string; message: string; fix?: string };
    };
    expect(deniedBody.error.code).toBe("authorization_error");
    // The refusal names the remedy rather than leaving the caller stuck.
    expect(`${deniedBody.error.message} ${deniedBody.error.fix ?? ""}`).toMatch(/full-scope key/i);
    // Reads are still allowed (any valid key), but never another project's data.
    expect((await call(data.secret, "/v1/emails")).status).toBe(200);
  });

  it("rotates without downtime: the new key works before the old one is revoked", async () => {
    const next = await call(bootstrapKey, "/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name: "production app (rotated)", env: "test", scope: "full" }),
    });
    const nextKey = ((await next.json()) as { data: { secret: string } }).data.secret;

    // Both keys alive during the switch — this is what makes rotation safe.
    expect((await send(nextKey, `rotated-a-${suffix}@test.test`)).status).toBe(202);
    expect((await send(appKey, `rotated-b-${suffix}@test.test`)).status).toBe(202);

    const revoked = await call(bootstrapKey, `/v1/keys/${appKeyId}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);

    // The old key is dead immediately; the new one is unaffected.
    const dead = await send(appKey, `after-revoke-${suffix}@test.test`);
    expect(dead.status).toBe(401);
    const deadBody = (await dead.json()) as { error: { code: string; message: string } };
    expect(deadBody.error.code).toBe("authentication_error");
    expect(deadBody.error.message).toMatch(/revoked/i);

    expect((await send(nextKey, `still-alive-${suffix}@test.test`)).status).toBe(202);
  });

  it("refuses an unissued key and a malformed bearer header", async () => {
    const missing = await app.request("/v1/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer calder_test_never_${suffix}`,
      },
      body: JSON.stringify({ from, to: "x@test.test", subject: "s", text: "t" }),
    });
    expect(missing.status).toBe(401);

    const noHeader = await app.request("/v1/emails", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to: "x@test.test", subject: "s", text: "t" }),
    });
    expect(noHeader.status).toBe(401);
  });
});
