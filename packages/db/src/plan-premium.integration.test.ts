import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Retired tiers stay storable and resolvable, but are never sold or seeded.
 *
 * Premium and Scale are retired from the commercial catalogue. Historical
 * subscriptions may still reference them, so resolution must keep returning
 * their own limits — never Beginner's — and `seedPlans()` must not delete or
 * recreate them. This suite simulates a legacy plan row the way production
 * would already have one.
 */
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("./client.js");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

gate("plan tier catalogue (live Postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_plan_${suffix}`;
  const userId = `usr_plan_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const { getDb, organizations, organizationMembers, users } = await import("./index.js");
    const { seedPlans } = await import("./seed.js");
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `plan-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Plan", slug: `plan-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_plan_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await seedPlans();
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const { getDb, cleanupSuiteOrg } = await import("./index.js");
    await cleanupSuiteOrg(getDb(), orgId, userId);
  });

  it("seeds the three commercial plans only", async () => {
    if (!(await reachable())) return;
    const { getDb, plans } = await import("./index.js");
    const { inArray } = await import("drizzle-orm");
    const rows = await getDb()
      .select({ tier: plans.tier, name: plans.name })
      .from(plans)
      .where(inArray(plans.tier, ["free", "starter", "pro"]));
    expect(rows.map((r) => r.tier).sort()).toEqual(["free", "pro", "starter"]);
    expect(rows.find((r) => r.tier === "pro")?.name).toBe("Pro");
  });

  it("preserves a historical Premium plan row across a re-seed", async () => {
    if (!(await reachable())) return;
    const { getDb, plans } = await import("./index.js");
    const { seedPlans } = await import("./seed.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    // Simulate a plan row created before retirement. It must survive seeding.
    await db
      .insert(plans)
      .values({ id: `plan_premium_${suffix}`, tier: "premium", name: "Premium" })
      .onConflictDoNothing();
    await seedPlans();
    const [row] = await db
      .select({ tier: plans.tier })
      .from(plans)
      .where(eq(plans.tier, "premium"));
    expect(row?.tier).toBe("premium");
  });

  it("stores a Premium subscription and resolves its historical limits", async () => {
    if (!(await reachable())) return;
    const { getDb, plans, subscriptions } = await import("./index.js");
    const { resolveOrgTier } = await import("./usage.js");
    const { PLAN_LIMITS, planFor } = await import("@calder/config");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const [premiumPlan] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.tier, "premium"))
      .limit(1);
    if (!premiumPlan) throw new Error("historical Premium plan row is missing");
    await db.insert(subscriptions).values({
      id: `sub_plan_${suffix}`,
      organizationId: orgId,
      planId: premiumPlan.id,
      status: "active",
    });
    expect(await resolveOrgTier(db, orgId)).toBe("premium");
    expect(planFor("premium").emailsPerMonth).toBe(250_000);
    expect(PLAN_LIMITS.premium.projects).toBe(50);
  });

  it("fails closed to Beginner for an unknown tier", async () => {
    const { planFor } = await import("@calder/config");
    expect(planFor("enterprise-unlimited").displayName).toBe("Beginner");
    expect(planFor(undefined).emailsPerMonth).toBe(5_000);
  });
});
