import { eq } from "drizzle-orm";
import { PLAN_LIMITS, PLAN_ORDER, type PlanTier } from "@calder/config";
import { getDb, organizations, projects, plans, planPrices } from "./index.js";

/**
 * Idempotent bootstrap: the founder-owned internal tenant that Calder's own
 * mail (waitlist confirmations, onboarding, billing) is sent under.
 * Safe to re-run, conflicts are ignored, nothing is overwritten.
 */
export async function seedInternalTenant(): Promise<{ orgId: string; projectId: string }> {
  const db = getDb();
  const orgId = "org_avenor";
  const projectId = "proj_website";
  await db
    .insert(organizations)
    .values({ id: orgId, name: "Calder", slug: "calder" })
    .onConflictDoNothing();
  await db
    .insert(projects)
    .values({ id: projectId, organizationId: orgId, name: "Website", slug: "website" })
    .onConflictDoNothing();
  return { orgId, projectId };
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("seed.ts") === true;

/**
 * Idempotent plan catalogue. Every value comes from `@calder/config`, so the
 * database cannot drift from the plans the application enforces.
 *
 * Every catalogue tier is seedable: `premium` was added to the `plan_tier`
 * enum in migration 0035, so the full five-tier catalogue now round-trips
 * through the database instead of advertising a tier no row could hold.
 */
type SeedableTier = PlanTier;

const SEEDABLE_TIERS: SeedableTier[] = [...PLAN_ORDER];

interface PlanSeed {
  tier: SeedableTier;
  name: string;
  prices: Array<{ currency: "NGN" | "USD"; amountCents: number }>;
}

const PLAN_SEED: PlanSeed[] = SEEDABLE_TIERS.map((tier) => {
  const plan = PLAN_LIMITS[tier];
  return {
    tier,
    name: plan.displayName,
    prices: (["NGN", "USD"] as const).flatMap((currency) => {
      const amountCents = plan.price[currency];
      // Scale is quoted per contract: a zero row would read as "free".
      return amountCents === null ? [] : [{ currency, amountCents }];
    }),
  };
});

export async function seedPlans(): Promise<void> {
  const db = getDb();
  for (const plan of PLAN_SEED) {
    const planId = `plan_${plan.tier}`;
    await db
      .insert(plans)
      .values({ id: planId, tier: plan.tier, name: plan.name })
      .onConflictDoNothing();
    /**
     * `tier` is the unique key, not `id`. A row for this tier may already
     * exist under a different id (an early test or a hand seed created one),
     * in which case the insert above is a no-op and `plan_free` is absent.
     * Prices must reference the row that actually exists or the FK fails and
     * the whole catalogue stops seeding.
     */
    const [existing] = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.tier, plan.tier))
      .limit(1);
    if (!existing) continue;
    for (const price of plan.prices) {
      await db
        .insert(planPrices)
        .values({
          id: `price_${plan.tier}_${price.currency.toLowerCase()}`,
          planId: existing.id,
          currency: price.currency,
          amountCents: price.amountCents,
          interval: "month",
        })
        .onConflictDoNothing();
    }
  }
}

if (invokedDirectly) {
  Promise.all([seedInternalTenant(), seedPlans()])
    .then(([{ orgId, projectId }]) => {
      console.log(`Seeded internal tenant: ${orgId} / ${projectId} + plan catalog`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
};
