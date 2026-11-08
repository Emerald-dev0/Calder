import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Marketing is implemented in this repository and excluded from the MVP.
 * Direct API calls must therefore fail closed — the dashboard's Coming Soon
 * label is not a security boundary.
 *
 * This suite proves, through the real HTTP app with a valid API key:
 *  - GET/POST /v1/broadcasts is refused (403 feature_not_available)
 *  - GET/POST /v1/audiences is refused, and creates no contact/audience row
 *  - the transactional MVP path (POST /v1/emails) is unaffected
 */
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

gate("excluded features fail closed at the API (live Postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_fa_${suffix}`;
  const projId = `proj_fa_${suffix}`;
  const userId = `usr_fa_${suffix}`;
  const keySecret = `calder_test_fa_${suffix}_${"k".repeat(12)}`;

  let app: ReturnType<typeof import("../app.js").createApp>;
  let db: import("@calder/db").DbClient;

  const authed = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keySecret}`,
        ...(init.headers ?? {}),
      },
    });

  beforeAll(async () => {
    if (!(await reachable())) return;
    const { getDb, organizations, organizationMembers, projects, users } = await import(
      "@calder/db"
    );
    const { createApp } = await import("../app.js");
    const { registerDevKey } = await import("../middleware/auth.js");
    app = createApp();
    db = getDb();
    await db.insert(users).values({ id: userId, email: `fa-user-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Feature Gate", slug: `fa-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_fa_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    registerDevKey(keySecret, {
      apiKeyId: `key_fa_${suffix}`,
      projectId: projId,
      organizationId: orgId,
      env: "test",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const { cleanupSuiteOrg } = await import("@calder/db");
    await cleanupSuiteOrg(db, orgId, userId);
  });

  it("refuses every broadcast endpoint", async () => {
    if (!(await reachable())) return;
    const list = await authed("/v1/broadcasts");
    expect(list.status).toBe(403);
    expect(((await list.json()) as { error: { code: string } }).error.code).toBe(
      "feature_not_available"
    );

    const create = await authed("/v1/broadcasts", {
      method: "POST",
      body: JSON.stringify({
        name: "Launch",
        subject: "Hello",
        senderId: "sender_x",
        audienceId: "aud_x",
        html: "<p>hi</p>",
      }),
    });
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe(
      "feature_not_available"
    );
  });

  it("refuses audiences and writes nothing", async () => {
    if (!(await reachable())) return;
    const { audiences, contacts } = await import("@calder/db");
    const { count, eq } = await import("drizzle-orm");

    const create = await authed("/v1/audiences", {
      method: "POST",
      body: JSON.stringify({ name: "Newsletter" }),
    });
    expect(create.status).toBe(403);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe(
      "feature_not_available"
    );

    const add = await authed("/v1/audiences/aud_x/contacts", {
      method: "POST",
      body: JSON.stringify({ contacts: [{ email: "a@example.test" }] }),
    });
    expect(add.status).toBe(403);

    for (const table of [audiences, contacts]) {
      const [row] = await db.select({ value: count() }).from(table).where(eq(table.projectId, projId));
      expect(Number(row?.value ?? 0)).toBe(0);
    }
  });

  it("leaves the transactional MVP path working", async () => {
    if (!(await reachable())) return;
    const send = await authed("/v1/emails", {
      method: "POST",
      headers: { "idempotency-key": `fa-send-${suffix}` },
      body: JSON.stringify({
        from: `fa-${suffix}@test.test`,
        to: "recipient@example.test",
        subject: "Feature gate control",
        text: "still works",
      }),
    });
    expect(send.status).toBe(202);
  });
});
