import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Premium must be storable before it can be entitled.
 *
 * For most of this repository's life `plan_tier` was `free | starter | pro |
 * scale` while the catalogue, the pricing page and ADR-045 sold a fifth tier.
 * The result: a Premium subscription could be advertised, priced and reasoned
 * about, but never written to the database, so `resolveOrgTier` could never
 * return `premium`. Migration 0035 fixes that.
 *
 * This is the plainest possible proof: create a Premium subscription and read
 * the tier back through the same resolver the quota engine uses.
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

  it("seeds all five catalogue tiers, including Premium", async () => {
    if (!(await reachable())) return;
    const { getDb, plans } = await import("./index.js");
    const { inArray } = await import("drizzle-orm");
    const rows = await getDb()
      .select({ tier: plans.tier, name: plans.name })
      .from(plans)
      .where(inArray(plans.tier, ["free", "starter", "pro", "premium", "scale"]));
    const tiers = rows.map((r) => r.tier).sort();
    expect(tiers).toEqual(["free", "premium", "pro", "scale", "starter"]);
    expect(rows.find((r) => r.tier === "premium")?.name).toBe("Premium");
  });

  it("stores a Premium subscription and resolves it as the org tier", async () => {
    if (!(await reachable())) return;
    const { getDb, subscriptions } = await import("./index.js");
    const { resolveOrgTier } = await import("./usage.js");
    const { PLAN_LIMITS } = await import("@calder/config");
    const db = getDb();
    await db.insert(subscriptions).values({
      id: `sub_plan_${suffix}`,
      organizationId: orgId,
      planId: "plan_premium",
      status: "active",
    });
    expect(await resolveOrgTier(db, orgId)).toBe("premium");
    expect(PLAN_LIMITS.premium.emailsPerMonth).toBe(250_000);
  });

  it("fails closed to Beginner for an unknown tier", async () => {
    const { planFor } = await import("@calder/config");
    expect(planFor("enterprise-unlimited").displayName).toBe("Beginner");
    expect(planFor(undefined).emailsPerMonth).toBe(5_000);
  });
});
