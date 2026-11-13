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
 * `POST /v1/senders` with `type: "gmail"` must refuse while the Gmail on-ramp is
 * not launched — even for a project that already holds an active transport.
 *
 * This is the case the dashboard cannot cover: the card, the server action and
 * the API each have to refuse independently, because a customer's own code
 * talks to the API directly. The feature registry says `coming_soon`, so the
 * expected answer is `403 feature_not_available` and **no sender row**.
 */
gate("POST /v1/senders refuses the Gmail on-ramp while it is not launched", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    senderIdentities,
    projectTransports,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");

  const db = getDb();
  const app = createApp();
  const suffix = randomBytes(4).toString("hex");
  const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const orgId = `org_gg_${suffix}`;
  const projId = `proj_gg_${suffix}`;
  const userId = `usr_gg_${suffix}`;
  const transportId = `tr_gg_${suffix}`;
  const liveKey = `sk_live_gg_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    await db.insert(users).values({ id: userId, email: `gg-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Gmail Gate", slug: `gg-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_gg_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db
      .insert(projects)
      .values({ id: projId, organizationId: orgId, name: "P", slug: `p-${suffix}` });
    // An active transport is exactly what used to be enough to create a sender.
    await db.insert(projectTransports).values({
      id: transportId,
      projectId: projId,
      type: "gmail",
      status: "active",
      label: `gg-${suffix}@gmail.test`,
    });
    registerDevKey(liveKey, {
      apiKeyId: rid("key"),
      projectId: projId,
      organizationId: orgId,
      env: "live",
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(db, orgId, userId);
  });

  it("answers 403 feature_not_available and writes no sender row", async () => {
    const res = await app.request("/v1/senders", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKey}` },
      body: JSON.stringify({
        display_name: "Gmail Gate",
        email: `gg-${suffix}@gmail.test`,
        type: "gmail",
        transport_id: transportId,
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: { feature?: string } };
    };
    expect(body.error.code).toBe("feature_not_available");
    expect(body.error.details?.feature).toBe("gmail_integration");
    // Customer-safe wording, pointing at the matrix rather than at internals.
    expect(body.error.message).not.toMatch(/GOOGLE_CLIENT|stack|sql/i);

    const rows = await db
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(eq(senderIdentities.projectId, projId));
    expect(rows).toHaveLength(0);
  });

  it("still serves domain senders on the same route", async () => {
    // The refusal must be scoped to one branch: if the gate leaked onto the
    // route, every domain sender creation would break too.
    const res = await app.request("/v1/senders", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKey}` },
      body: JSON.stringify({
        display_name: "Domain Sender",
        email: `hello-${suffix}@gg.test`,
        type: "domain",
      }),
    });
    // Not 403 for the feature: a domain sender without a verified domain is a
    // 422 domain_not_verified, which proves the route is still reachable.
    expect(res.status).not.toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("domain_not_verified");
  });
});
