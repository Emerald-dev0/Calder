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
 * Idempotent plan catalog matching PRD §11 (hypothesis pricing, NGN-led).
 * Amounts are illustrative seeds, change via dashboard/billing UI in production,
 * never by editing this file after launch. Safe to re-run.
 */
const PLAN_SEED: Array<{
  tier: "free" | "starter" | "pro" | "scale";
  name: string;
  prices: Array<{ currency: "NGN" | "USD"; amountCents: number }>;
}> = [
  { tier: "free", name: "Free", prices: [{ currency: "NGN", amountCents: 0 }] },
  {
    tier: "starter",
    name: "Builder",
    prices: [
      { currency: "NGN", amountCents: 1000000 },
      { currency: "USD", amountCents: 700 },
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    prices: [
      { currency: "NGN", amountCents: 2500000 },
      { currency: "USD", amountCents: 1600 },
    ],
  },
  {
    tier: "scale",
    name: "Scale",
    prices: [
      { currency: "NGN", amountCents: 6000000 },
      { currency: "USD", amountCents: 4000 },
    ],
  },
];

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
