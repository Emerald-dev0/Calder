import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { PLAN_LIMITS } from "@calder/config";
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
 * Only tiers the `plan_tier` enum can hold are seeded — `premium` exists in the
 * catalogue but cannot be stored until billing adds it to the enum, which is a
 * migration for that phase, not this one.
 */
/** Exactly the values the `plan_tier` enum can hold today. */
type SeedableTier = "free" | "starter" | "pro" | "scale";

const SEEDABLE_TIERS: SeedableTier[] = ["free", "starter", "pro", "scale"];

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
    for (const price of plan.prices) {
      await db
        .insert(planPrices)
        .values({
          id: `price_${plan.tier}_${price.currency.toLowerCase()}`,
          planId,
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
}
