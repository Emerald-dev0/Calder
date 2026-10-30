import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_ORDER, formatPlanPrice } from "@calder/config/plan-limits";
import { COMPARISON, MARKETING_ALLOWANCES, PLANS, planPrice, planSummary } from "./plans";
import { SIGNUP_URL } from "./site";
import { pricingJsonLd } from "./seo";

/**
 * The marketing site is a projection of the plan catalogue. These assertions
 * exist so a stray literal in a card or a table cannot quietly contradict the
 * limits the API enforces.
 */
describe("marketing plans match the catalogue", () => {
  it("prices every plan from the catalogue", () => {
    const expected = {
      beginner: "free",
      starter: "starter",
      pro: "pro",
      premium: "premium",
      scale: "scale",
    } as const;
    for (const plan of PLANS) {
      const tier = expected[plan.id as keyof typeof expected];
      expect(plan.price.NGN, `${plan.id} NGN`).toBe(formatPlanPrice(tier, "NGN"));
      expect(plan.price.USD, `${plan.id} USD`).toBe(formatPlanPrice(tier, "USD"));
    }
  });

  it("never prints the superseded Pro or Premium dollar prices", () => {
    expect(planPrice("pro", "NGN")).toBe("₦20,000");
    expect(planPrice("pro", "USD")).toBe("$18");
    expect(planPrice("premium", "USD")).toBe("$65");
    for (const plan of PLANS) {
      expect(plan.price.USD).not.toBe("$15");
      expect(plan.price.NGN).not.toBe("₦25,000");
      expect(plan.price.USD).not.toBe("$49");
    }
  });

  it("prints the catalogue's volumes, seats and retention", () => {
    const beginner = PLANS.find((p) => p.id === "beginner")!;
    expect(beginner.volume).toContain("5,000");
    expect(beginner.domains).toBe("2");
    expect(beginner.team).toBe("1");
    expect(beginner.logs).toBe("7 days");

    const premium = PLANS.find((p) => p.id === "premium")!;
    expect(premium.volume).toContain("250,000");
    expect(premium.projects).toBe("50");
    expect(premium.team).toBe("15");
    expect(premium.logs).toBe("90 days");

    const scale = PLANS.find((p) => p.id === "scale")!;
    expect(scale.projects).toBe("Custom");
    expect(scale.volume).toBe("Custom volume");
  });

  it("summarises Beginner exactly as the docs quote it", () => {
    expect(planSummary("beginner")).toBe("5,000 emails, 3 projects, 2 domains");
  });

  it("shows one value per plan in every comparison row", () => {
    // The table renders a column per plan. `values` used to be a 4-tuple while
    // five plans existed, so the last column was empty on every row and the
    // emails row sat under the wrong headings.
    const groups = [...COMPARISON, { group: "Marketing", rows: MARKETING_ALLOWANCES }];
    for (const group of groups) {
      for (const row of group.rows) {
        expect(row.values, `${group.group} → ${row.label}`).toHaveLength(PLANS.length);
      }
    }
  });

  it("recommends exactly one plan", () => {
    // Two featured cards is not a recommendation; it also rendered as no
    // featured card at all while the class name was malformed.
    expect(PLANS.filter((p) => p.popular)).toHaveLength(1);
  });

  it("has a plan for every tier the site names", () => {
    expect(PLANS.map((p) => p.name)).toEqual(PLAN_ORDER.map((t) => PLAN_LIMITS[t].displayName));
    for (const plan of PLANS) {
      expect(plan.highlights.length, plan.id).toBeGreaterThan(0);
    }
  });

  it("sends every plan CTA somewhere that exists", () => {
    // A bare "/signup" used to pass, and every card on /pricing 404'd: signup
    // lives on the dashboard origin, not on calder.click. Plan CTAs must be
    // absolute, an in-page anchor, or mailto — never a path into this app
    // unless a route actually exists for it.
    for (const plan of PLANS) {
      expect(plan.ctaHref, plan.id).toMatch(/^(https:\/\/|mailto:|#)/);
    }
    expect(PLANS.filter((p) => p.id !== "scale").every((p) => p.ctaHref === SIGNUP_URL)).toBe(true);
  });

  it("keeps every catalogue tier named the same everywhere", () => {
    const names = PLAN_ORDER.map((t) => PLAN_LIMITS[t].displayName);
    expect(names).toEqual(["Beginner", "Starter", "Pro", "Premium", "Scale"]);
    expect(PLANS.map((p) => p.name)).toEqual(["Beginner", "Starter", "Pro", "Premium", "Scale"]);
  });

  it("emits only offers a crawler can price", () => {
    // Scale is quoted, so schema.org must not hear about a null price; Google
    // flags such an Offer with "Missing field 'price'".
    const data = pricingJsonLd(PLANS) as {
      offers: { name: string; price?: string; priceCurrency?: string }[];
    };
    expect(data.offers.length).toBeGreaterThan(0);
    for (const offer of data.offers) {
      expect(offer.price, offer.name).toMatch(/^\d+(\.\d+)?$/);
      expect(offer.priceCurrency, offer.name).toMatch(/^(NGN|USD)$/);
    }
    expect(data.offers.every((o) => o.name.startsWith("Beginner"))).toBe(true);
  });
});
