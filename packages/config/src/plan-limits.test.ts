import { describe, expect, it } from "vitest";
import {
  EXEMPT_TIERS,
  LIMITED_RESOURCES,
  PLAN_LIMITS,
  PLAN_ORDER,
  UNENFORCED_PLAN_LIMITS,
  USAGE_WARNING_RATIOS,
  checkResourceLimit,
  formatPlanPrice,
  planDisplayName,
  planEmailsLimit,
  planFor,
  planWarningThresholds,
  isExemptTier,
  resourceLimit,
  upgradeTierFor,
} from "./plan-limits";

/**
 * The catalogue is read by every surface, so its numbers are asserted here
 * rather than in each consumer. If a plan value changes, this suite changes
 * with it — and the diff explains itself.
 */
describe("plan catalogue", () => {
  it("has the five tiers in order, with the sanctioned display names", () => {
    expect(PLAN_ORDER).toEqual(["free", "starter", "pro", "premium", "scale"]);
    expect(PLAN_ORDER.map((t) => PLAN_LIMITS[t].displayName)).toEqual([
      "Beginner",
      "Starter",
      "Pro",
      "Premium",
      "Scale",
    ]);
  });

  it("matches the approved email allowances", () => {
    expect(planEmailsLimit("free")).toBe(5_000);
    expect(planEmailsLimit("starter")).toBe(10_000);
    expect(planEmailsLimit("pro")).toBe(50_000);
    expect(planEmailsLimit("premium")).toBe(250_000);
    expect(planEmailsLimit("scale")).toBeNull();
  });

  it("matches the approved resource limits", () => {
    const table = {
      free: { projects: 3, domains: 2, senders: 5, seats: 1 },
      starter: { projects: 3, domains: 3, senders: 10, seats: 2 },
      pro: { projects: 10, domains: 10, senders: 25, seats: 5 },
      premium: { projects: 50, domains: 50, senders: 100, seats: 15 },
    } as const;
    for (const [tier, expected] of Object.entries(table)) {
      for (const resource of LIMITED_RESOURCES) {
        expect(resourceLimit(tier, resource), `${tier}.${resource}`).toBe(
          expected[resource as keyof typeof expected]
        );
      }
    }
    for (const resource of LIMITED_RESOURCES) {
      expect(resourceLimit("scale", resource)).toBeNull();
    }
  });

  it("keeps retention, Gmail senders and the daily cap as recorded-only", () => {
    expect(PLAN_LIMITS.free.retentionDays).toBe(7);
    expect(PLAN_LIMITS.starter.retentionDays).toBe(14);
    expect(PLAN_LIMITS.pro.retentionDays).toBe(30);
    expect(PLAN_LIMITS.premium.retentionDays).toBe(90);
    for (const tier of PLAN_ORDER)
      expect(PLAN_LIMITS[tier].gmailSenders).toBe(tier === "scale" ? null : 2);
    expect(PLAN_LIMITS.free.dailySendCap).toBe(500);
    expect(PLAN_LIMITS.premium.dailySendCap).toBeNull();
    expect([...UNENFORCED_PLAN_LIMITS]).toEqual(["retentionDays", "gmailSenders", "dailySendCap"]);
  });

  it("never approves the contacts allowance", () => {
    for (const tier of PLAN_ORDER) {
      expect(PLAN_LIMITS[tier].contacts.approved).toBe(false);
    }
  });

  it("prices NGN and USD independently, removed the old Pro figures", () => {
    expect(formatPlanPrice("free", "NGN")).toBe("₦0");
    expect(formatPlanPrice("free", "USD")).toBe("$0");
    expect(formatPlanPrice("starter", "NGN")).toBe("₦5,000");
    expect(formatPlanPrice("starter", "USD")).toBe("$5");
    expect(formatPlanPrice("pro", "NGN")).toBe("₦20,000");
    expect(formatPlanPrice("pro", "USD")).toBe("$18");
    expect(formatPlanPrice("premium", "NGN")).toBe("₦75,000");
    expect(formatPlanPrice("premium", "USD")).toBe("$65");
    expect(formatPlanPrice("scale", "NGN")).toBe("Custom");
    expect(formatPlanPrice("scale", "USD")).toBe("Custom");
    // The superseded Pro pricing must not survive anywhere in the catalogue.
    expect(formatPlanPrice("pro", "NGN")).not.toBe("₦25,000");
    expect(formatPlanPrice("pro", "USD")).not.toBe("$15");
  });

  it("falls back to Beginner for an unknown or missing tier", () => {
    expect(planFor(null).displayName).toBe("Beginner");
    expect(planFor("").displayName).toBe("Beginner");
    expect(planFor("gold").displayName).toBe("Beginner");
    expect(planEmailsLimit("gold")).toBe(5_000);
    expect(planDisplayName(undefined)).toBe("Beginner");
  });
});

describe("warning thresholds", () => {
  it("are computed from the allowance, not hardcoded per plan", () => {
    expect(planWarningThresholds("free")).toEqual([2_500, 4_000]);
    expect(planWarningThresholds("starter")).toEqual([5_000, 8_000]);
    expect(planWarningThresholds("pro")).toEqual([25_000, 40_000]);
    expect(planWarningThresholds("premium")).toEqual([125_000, 200_000]);
  });

  it("are exactly the ratios of the limit for every metered plan", () => {
    for (const tier of PLAN_ORDER) {
      const limit = planEmailsLimit(tier);
      if (limit === null) continue;
      expect(planWarningThresholds(tier)).toEqual(USAGE_WARNING_RATIOS.map((r) => limit * r));
    }
  });

  it("are empty for an unmetered plan", () => {
    expect(planWarningThresholds("scale")).toEqual([]);
  });
});

describe("checkResourceLimit", () => {
  it("allows creation below the ceiling", () => {
    const d = checkResourceLimit("free", "projects", 2);
    expect(d.allowed).toBe(true);
    expect(d.limit).toBe(3);
  });

  it("refuses creation at the ceiling with a code, a message and an upgrade pointer", () => {
    const d = checkResourceLimit("free", "projects", 3);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("plan_limit_reached");
    expect(d.limit).toBe(3);
    expect(d.used).toBe(3);
    expect(d.message).toContain("Beginner");
    expect(d.message).toContain("3 projects");
    // Starter does not raise the project ceiling, so the pointer must skip it.
    expect(d.upgradeTier).toBe("pro");
    expect(d.upgradeDisplayName).toBe("Pro");
  });

  it("lets an over-limit workspace keep what it has but add nothing", () => {
    // Grandfathering: 9 domains on a 2-domain plan is legal; a 10th is not.
    const d = checkResourceLimit("free", "domains", 9);
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("plan_limit_reached");
  });

  it("points at Scale with a contract message when no plan raises the ceiling", () => {
    const d = checkResourceLimit("premium", "seats", 15);
    expect(d.allowed).toBe(false);
    expect(d.upgradeTier).toBe("scale");
    expect(d.message).toContain("Scale");
  });

  it("never blocks a custom plan", () => {
    expect(checkResourceLimit("scale", "domains", 10_000).allowed).toBe(true);
  });

  it("fails closed for an unknown tier", () => {
    expect(checkResourceLimit("gold", "projects", 3).allowed).toBe(false);
  });

  it("never blocks the internal or test tiers, like the quota path", () => {
    // `packages/db/src/usage.ts` returns reason "internal-org" / "test-env"
    // before consulting a ceiling. The resource check must agree: an internal
    // workspace on project 40 is not "over Beginner's limit of 3".
    for (const tier of EXEMPT_TIERS) {
      for (const resource of LIMITED_RESOURCES) {
        const d = checkResourceLimit(tier, resource, 10_000);
        expect(d.allowed, `${tier}.${resource}`).toBe(true);
        expect(d.limit, `${tier}.${resource}`).toBeNull();
        expect(d.code).toBeUndefined();
      }
    }
    expect(isExemptTier("internal")).toBe(true);
    expect(isExemptTier("n/a")).toBe(true);
    expect(isExemptTier("free")).toBe(false);
    expect(isExemptTier(undefined)).toBe(false);
    expect(isExemptTier("")).toBe(false);
  });

  it("still resolves a display name for an exempt tier without pretending it is a plan", () => {
    // The lookup falls back to Beginner's *name* for unknown strings, but the
    // decision above never consults a limit, so nothing is gated.
    expect(checkResourceLimit("internal", "seats", 99).allowed).toBe(true);
    expect(planDisplayName("internal")).toBe("Beginner");
  });

  it("skips tiers that do not raise this particular ceiling", () => {
    expect(upgradeTierFor("free", "domains")).toBe("starter"); // 2 → 3
    expect(upgradeTierFor("starter", "projects")).toBe("pro"); // 3 → 3 → 10
    expect(upgradeTierFor("premium", "projects")).toBe("scale");
    expect(upgradeTierFor("scale", "projects")).toBeNull();
  });

  it("uses the right noun for a single seat", () => {
    const d = checkResourceLimit("free", "seats", 1);
    expect(d.message).toContain("1 team seat and");
  });
});
