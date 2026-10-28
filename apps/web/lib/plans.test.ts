import { describe, expect, it } from "vitest";
import { PLAN_LIMITS, PLAN_ORDER, formatPlanPrice } from "@calder/config/plan-limits";
import { PLANS, planPrice, planSummary } from "./plans";

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

  it("keeps every catalogue tier named the same everywhere", () => {
    const names = PLAN_ORDER.map((t) => PLAN_LIMITS[t].displayName);
    expect(names).toEqual(["Beginner", "Starter", "Pro", "Premium", "Scale"]);
    expect(PLANS.map((p) => p.name)).toEqual(["Beginner", "Starter", "Pro", "Premium", "Scale"]);
  });
});
