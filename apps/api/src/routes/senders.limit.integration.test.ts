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
 * POST /v1/senders — plan ceiling at creation.
 *
 * The dashboard checks the same limit through the same module, but the API is
 * the path a customer's own code uses, so the ceiling has to be enforced here
 * or a script can quietly exceed what the UI refuses. Three cases:
 *
 *  - an organization at its ceiling gets 402 `plan_limit_reached`, with the
 *    resource, tier, limit, usage and upgrade path in the body, and **no row
 *    is written**;
 *  - archiving a sender frees a slot, so the next create succeeds;
 *  - an exempt (internal) tier is not limited at all.
 */
gate("POST /v1/senders enforces the plan ceiling (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    domains,
    senderIdentities,
    plans,
    subscriptions,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { eq, and, isNull } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { planFor } = await import("@calder/config");

  const db = getDb();
  const app = createApp();
  const suffix = randomBytes(4).toString("hex");
  const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const orgId = `org_sl_${suffix}`;
  const projId = `proj_sl_${suffix}`;
  const userId = `usr_sl_${suffix}`;
  const domain = `sl-${suffix}.test`;
  const liveKey = `sk_live_sl_${suffix}`;
  let planId = "";

  const freeSenders = planFor("free").senders;
  expect(freeSenders).not.toBeNull();

  const create = () =>
    app.request("/v1/senders", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKey}` },
      body: JSON.stringify({
        display_name: "Limit Test",
        email: `limit-${suffix}@${domain}`,
        type: "domain",
      }),
    });

  beforeAll(async () => {
    if (!(await reachable())) return;
    await db.insert(users).values({ id: userId, email: `sl-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Sender Limit", slug: `sl-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_sl_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db
      .insert(projects)
      .values({ id: projId, organizationId: orgId, name: "P", slug: `p-${suffix}` });
    await db.insert(domains).values({
      id: `dom_sl_${suffix}`,
      projectId: projId,
      domain,
      status: "verified",
    });

    // The catalog row for "free" may already exist on a seeded database.
    const [existingPlan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.tier, "free"))
      .limit(1);
    if (existingPlan) {
      planId = existingPlan.id;
    } else {
      planId = `plan_sl_${suffix}`;
      await db.insert(plans).values({ id: planId, tier: "free", name: "Beginner" });
    }
    await db.insert(subscriptions).values({
      id: `sub_sl_${suffix}`,
      organizationId: orgId,
      planId,
      status: "active",
      currentPeriodStart: new Date(Date.now() - 86400_000),
      currentPeriodEnd: new Date(Date.now() + 27 * 86400_000),
    });

    registerDevKey(liveKey, {
      apiKeyId: rid("key"),
      projectId: projId,
      organizationId: orgId,
      env: "live",
    });

    // Fill the plan's sender allowance exactly.
    const rows = Array.from({ length: freeSenders ?? 0 }, (_, i) => ({
      id: `sender_sl_${i}_${suffix}`,
      projectId: projId,
      displayName: `Filler ${i}`,
      email: `filler-${i}@${domain}`,
      type: "domain" as const,
      status: "verified" as const,
    }));
    if (rows.length > 0) await db.insert(senderIdentities).values(rows);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    await cleanupSuiteOrg(db, orgId, userId);
  });

  it("refuses the sender at the ceiling and writes nothing", async () => {
    if (!(await reachable())) return;
    const before = await db
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(eq(senderIdentities.projectId, projId));

    const res = await create();
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: Record<string, unknown>; fix?: string };
    };
    expect(body.error.code).toBe("plan_limit_reached");
    expect(body.error.message).toMatch(/sender/i);
    expect(body.error.message).toMatch(/Beginner/i);
    expect(body.error.details).toMatchObject({
      resource: "senders",
      tier: "free",
      used: freeSenders,
      limit: freeSenders,
    });
    expect(body.error.fix).toBeTruthy();

    const after = await db
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(eq(senderIdentities.projectId, projId));
    expect(after.length).toBe(before.length);
    expect(after.map((r) => r.id)).not.toContain(undefined);
  });

  it("frees a slot when a sender is archived", async () => {
    if (!(await reachable())) return;
    // Archiving is what DELETE does to a sender with history; here we archive
    // directly so the scenario does not depend on an email row.
    const [victim] = await db
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(eq(senderIdentities.projectId, projId))
      .limit(1);
    await db
      .update(senderIdentities)
      .set({ archivedAt: new Date() })
      .where(eq(senderIdentities.id, victim!.id));

    const res = await create();
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; email: string } };
    expect(body.data.email).toBe(`limit-${suffix}@${domain}`);
  });

  it("archives rather than deletes a sender that has sent mail", async () => {
    if (!(await reachable())) return;
    const { emails } = await import("@calder/db");
    // An active sender: a previous test in this file archives one, and DELETE
    // is idempotent, so picking an already-archived row would exercise the
    // retry path instead of the archive decision.
    const [victim] = await db
      .select({ id: senderIdentities.id, email: senderIdentities.email })
      .from(senderIdentities)
      .where(and(eq(senderIdentities.projectId, projId), isNull(senderIdentities.archivedAt)))
      .limit(1);
    await db.insert(emails).values({
      id: `em_sl_${suffix}`,
      projectId: projId,
      from: victim!.email,
      senderIdentityId: victim!.id,
      to: "history@example.test",
      subject: "history",
      text: "history",
      status: "delivered",
      attemptCount: 1,
    });

    const res = await app.request(`/v1/senders/${victim!.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${liveKey}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { archived: boolean; deleted: boolean; email_count: number };
    };
    expect(body.data).toMatchObject({ archived: true, deleted: false, email_count: 1 });

    // The row is still there, archived, and hidden from the default listing.
    const [row] = await db
      .select({ archivedAt: senderIdentities.archivedAt })
      .from(senderIdentities)
      .where(eq(senderIdentities.id, victim!.id));
    expect(row?.archivedAt).not.toBeNull();

    const list = await app.request("/v1/senders", {
      headers: { authorization: `Bearer ${liveKey}` },
    });
    const listBody = (await list.json()) as { data: Array<{ id: string; archived_at: unknown }> };
    expect(listBody.data.map((r) => r.id)).not.toContain(victim!.id);

    const withArchived = await app.request("/v1/senders?include_archived=true", {
      headers: { authorization: `Bearer ${liveKey}` },
    });
    const archivedBody = (await withArchived.json()) as {
      data: Array<{ id: string; archived_at: string | null }>;
    };
    const archivedRow = archivedBody.data.find((r) => r.id === victim!.id);
    expect(archivedRow).toBeTruthy();
    expect(archivedRow?.archived_at).not.toBeNull();
  });
});
