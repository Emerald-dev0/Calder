import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_ORDER, formatPlanPrice } from "@calder/config/plan-limits";
import { COMPARISON, MARKETING_ALLOWANCES, PLANS, planPrice, planSummary } from "./plans";
import { SIGNUP_URL } from "./site";
import { pricingJsonLd } from "./seo";

/**
 * The marketing site is a projection of the plan catalogue. These assertions
 * exist so a stray literal in a card or a table cannot quietly contradict the
 * limits the API enforces, and so a retired tier cannot reappear as a
 * purchasable plan.
 */
describe("marketing plans match the commercial catalogue", () => {
  const TIER_OF = { beginner: "free", starter: "starter", pro: "pro" } as const;

  it("renders exactly the three commercial plans", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["beginner", "starter", "pro"]);
    expect(PLANS.map((p) => p.name)).toEqual(["Beginner", "Starter", "Pro"]);
    expect(PLAN_ORDER).toEqual(["free", "starter", "pro"]);
  });

  it("never renders Premium or Scale anywhere in the marketing catalogue", () => {
    const serialized = JSON.stringify({ PLANS, COMPARISON, MARKETING_ALLOWANCES });
    expect(serialized).not.toMatch(/Premium/);
    expect(serialized).not.toMatch(/\bScale\b/);
    expect(PLANS.map((p) => p.name)).not.toContain("Premium");
    expect(PLANS.map((p) => p.name)).not.toContain("Scale");
  });

  it("keeps the retired tiers resolvable and their historical limits intact", () => {
    expect(PLAN_LIMITS.premium.retired).toBe(true);
    expect(PLAN_LIMITS.scale.retired).toBe(true);
    expect(PLAN_LIMITS.premium.emailsPerMonth).toBe(250_000);
    expect(PLAN_LIMITS.premium.projects).toBe(50);
    expect(PLAN_LIMITS.scale.emailsPerMonth).toBeNull();
    // They are not part of the commercial order the page iterates.
    expect(PLAN_ORDER).not.toContain("premium");
    expect(PLAN_ORDER).not.toContain("scale");
  });

  it("prices every plan from the catalogue", () => {
    for (const plan of PLANS) {
      const tier = TIER_OF[plan.id];
      expect(plan.price.NGN, `${plan.id} NGN`).toBe(formatPlanPrice(tier, "NGN"));
      expect(plan.price.USD, `${plan.id} USD`).toBe(formatPlanPrice(tier, "USD"));
    }
    expect(planPrice("starter", "NGN")).toBe("₦5,000");
    expect(planPrice("starter", "USD")).toBe("$5");
    expect(planPrice("pro", "NGN")).toBe("₦20,000");
    expect(planPrice("pro", "USD")).toBe("$18");
  });

  it("prints the catalogue's volumes and resource counts", () => {
    const beginner = PLANS.find((p) => p.id === "beginner")!;
    expect(beginner.volume).toContain("5,000");
    expect(beginner.domains).toBe("2");
    expect(beginner.team).toBe("1");

    const starter = PLANS.find((p) => p.id === "starter")!;
    expect(starter.volume).toContain("10,000");
    expect(starter.projects).toBe("3");

    const pro = PLANS.find((p) => p.id === "pro")!;
    expect(pro.volume).toContain("50,000");
    expect(pro.projects).toBe("10");
    expect(pro.team).toBe("5");
  });

  it("summarises Beginner exactly as the docs quote it", () => {
    expect(planSummary("beginner")).toBe("5,000 emails, 3 projects, 2 domains");
  });

  it("shows one value per plan in every comparison row", () => {
    const groups = [...COMPARISON, { group: "Marketing", rows: MARKETING_ALLOWANCES }];
    for (const group of groups) {
      for (const row of group.rows) {
        expect(row.values, `${group.group} → ${row.label}`).toHaveLength(PLANS.length);
      }
    }
  });

  it("does not advertise retention, environments or tier-restricted tools", () => {
    const highlights = PLANS.flatMap((p) => p.highlights).join(" | ");
    expect(highlights).not.toMatch(/retention/i);
    expect(highlights).not.toMatch(/environment/i);
    expect(highlights).not.toMatch(/webhook replay/i);

    const rows = COMPARISON.flatMap((group) => group.rows);
    expect(rows.some((row) => /retention/i.test(row.label))).toBe(false);
    expect(rows.some((row) => /^environments$/i.test(row.label))).toBe(false);
    // Tools available to everyone may be listed, but never as a tier difference.
    for (const label of ["Scoped API keys", "Webhook replay and delivery history"]) {
      const row = rows.find((r) => r.label === label);
      if (row) expect(new Set(row.values).size, label).toBe(1);
    }
  });

  it("recommends exactly one plan", () => {
    expect(PLANS.filter((p) => p.popular)).toHaveLength(1);
  });

  it("sends every plan CTA to signup", () => {
    for (const plan of PLANS) {
      expect(plan.ctaHref, plan.id).toBe(SIGNUP_URL);
    }
  });

  it("emits only offers a crawler can price", () => {
    const data = pricingJsonLd(PLANS) as {
      offers: { name: string; price?: string; priceCurrency?: string }[];
    };
    expect(data.offers.length).toBeGreaterThan(0);
    for (const offer of data.offers) {
      expect(offer.price, offer.name).toMatch(/^\d+(\.\d+)?$/);
      expect(offer.priceCurrency, offer.name).toMatch(/^(NGN|USD)$/);
    }
    // Paid checkout is unavailable, so only the free plan is a live offer.
    expect(data.offers.every((o) => o.name.startsWith("Beginner"))).toBe(true);
  });
});
