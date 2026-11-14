import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_PLAN_ORDER,
  EXEMPT_TIERS,
  KNOWN_TIERS,
  LIMITED_RESOURCES,
  PLAN_LIMITS,
  PLAN_ORDER,
  RETIRED_TIERS,
  UNENFORCED_PLAN_LIMITS,
  UnassignablePlanTierError,
  assertAssignableTier,
  isCommercialTier,
  USAGE_WARNING_RATIOS,
  checkInboundAllowance,
  checkResourceLimit,
  formatPlanPrice,
  inboundUpgradeTier,
  planInboundEmailsLimit,
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
  it("sells exactly three commercial plans, with the sanctioned display names", () => {
    expect(COMMERCIAL_PLAN_ORDER).toEqual(["free", "starter", "pro"]);
    expect(COMMERCIAL_PLAN_ORDER.map((t) => PLAN_LIMITS[t].displayName)).toEqual([
      "Beginner",
      "Starter",
      "Pro",
    ]);
    // PLAN_ORDER is the commercial order; it must never point at a retired tier.
    expect(PLAN_ORDER).toEqual([...COMMERCIAL_PLAN_ORDER]);
  });

  it("still knows every historical tier, including the retired ones", () => {
    expect(KNOWN_TIERS).toEqual(["free", "starter", "pro", "premium", "scale"]);
    expect(KNOWN_TIERS.map((t) => PLAN_LIMITS[t].displayName)).toEqual([
      "Beginner",
      "Starter",
      "Pro",
      "Premium",
      "Scale",
    ]);
    expect(RETIRED_TIERS).toEqual(["premium", "scale"]);
    for (const tier of KNOWN_TIERS) {
      expect(PLAN_LIMITS[tier].retired, tier).toBe(
        (RETIRED_TIERS as readonly string[]).includes(tier)
      );
    }
  });

  it("classifies tiers for assignment without touching resolution", () => {
    expect(isCommercialTier("free")).toBe(true);
    expect(isCommercialTier("starter")).toBe(true);
    expect(isCommercialTier("pro")).toBe(true);
    expect(isCommercialTier("premium")).toBe(false);
    expect(isCommercialTier("scale")).toBe(false);
    expect(isCommercialTier("gold")).toBe(false);
    expect(isCommercialTier(null)).toBe(false);
  });

  it("resolves retired tiers to their own historical limits, never to Beginner", () => {
    expect(planFor("premium").displayName).toBe("Premium");
    expect(planFor("premium").emailsPerMonth).toBe(250_000);
    expect(planFor("premium").projects).toBe(50);
    expect(planFor("scale").emailsPerMonth).toBeNull();
    expect(planDisplayName("premium")).toBe("Premium");
    expect(PLAN_LIMITS.premium.retired).toBe(true);
  });

  it("rejects retired and unknown tiers for new assignments", () => {
    expect(assertAssignableTier("pro")).toBe("pro");
    expect(assertAssignableTier("free")).toBe("free");
    for (const tier of ["premium", "scale", "gold", "", null, undefined]) {
      expect(() => assertAssignableTier(tier), String(tier)).toThrow(UnassignablePlanTierError);
    }
    try {
      assertAssignableTier("premium");
    } catch (err) {
      expect(err).toBeInstanceOf(UnassignablePlanTierError);
      expect((err as UnassignablePlanTierError).code).toBe("plan_not_assignable");
      expect((err as UnassignablePlanTierError).retired).toBe(true);
      expect((err as UnassignablePlanTierError).message).toContain("Premium is retired");
    }
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
      free: { projects: 3, domains: 2, senders: 5, seats: 1, receivingDomains: 2 },
      starter: { projects: 3, domains: 3, senders: 10, seats: 2, receivingDomains: 3 },
      pro: { projects: 10, domains: 10, senders: 25, seats: 5, receivingDomains: 10 },
      premium: { projects: 50, domains: 50, senders: 100, seats: 15, receivingDomains: 50 },
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
    for (const tier of KNOWN_TIERS)
      expect(PLAN_LIMITS[tier].gmailSenders).toBe(tier === "scale" ? null : 2);
    expect(PLAN_LIMITS.free.dailySendCap).toBe(500);
    expect(PLAN_LIMITS.premium.dailySendCap).toBeNull();
    expect([...UNENFORCED_PLAN_LIMITS]).toEqual([
      "retentionDays",
      "gmailSenders",
      "inboundStorageMb",
    ]);
  });

  it("never approves the contacts allowance", () => {
    for (const tier of KNOWN_TIERS) {
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
    for (const tier of KNOWN_TIERS) {
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

  it("never recommends a retired plan when no commercial plan raises the ceiling", () => {
    const d = checkResourceLimit("premium", "seats", 15);
    expect(d.allowed).toBe(false);
    expect(d.upgradeTier).toBeNull();
    expect(d.upgradeDisplayName).toBeNull();
    expect(d.message).toContain("Contact us");
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
    // Retired tiers have no commercial successor and are never suggested.
    expect(upgradeTierFor("premium", "projects")).toBeNull();
    expect(upgradeTierFor("scale", "projects")).toBeNull();
    expect(upgradeTierFor("free", "projects")).toBe("pro");
  });

  it("uses the right noun for a single seat", () => {
    const d = checkResourceLimit("free", "seats", 1);
    expect(d.message).toContain("1 team seat and");
  });
});

describe("inbound allowance", () => {
  it("is its own dimension, never derived from the outbound allowance", () => {
    // A 10,000-outbound plan is not a 10,000-inbound plan by accident.
    const table = { free: 500, starter: 2_000, pro: 10_000, premium: 50_000 } as const;
    for (const [tier, expected] of Object.entries(table)) {
      expect(planInboundEmailsLimit(tier), tier).toBe(expected);
      expect(planInboundEmailsLimit(tier), tier).not.toBe(planEmailsLimit(tier));
    }
    expect(planInboundEmailsLimit("scale")).toBeNull();
    // Unknown tiers fail closed to Beginner, exactly as the outbound side does.
    expect(planInboundEmailsLimit("gold")).toBe(500);
    expect(planInboundEmailsLimit(undefined)).toBe(500);
  });

  it("admits messages below the ceiling and refuses at it, with an upgrade pointer", () => {
    expect(checkInboundAllowance("free", 0).allowed).toBe(true);
    expect(checkInboundAllowance("free", 499).allowed).toBe(true);

    const refused = checkInboundAllowance("free", 500);
    expect(refused.allowed).toBe(false);
    expect(refused.code).toBe("inbound_quota_exhausted");
    expect(refused.limit).toBe(500);
    expect(refused.received).toBe(500);
    expect(refused.message).toContain("Beginner");
    expect(refused.message).toContain("inbound");
    expect(refused.upgradeTier).toBe("starter");
    expect(refused.upgradeDisplayName).toBe("Starter");
  });

  it("treats a contract plan as uncapped rather than as zero", () => {
    const d = checkInboundAllowance("scale", 10_000_000);
    expect(d.allowed).toBe(true);
    expect(d.limit).toBeNull();
    expect(d.upgradeTier).toBeUndefined();
  });

  it("exempts internal workspaces the same way the send path does", () => {
    for (const tier of EXEMPT_TIERS) {
      expect(checkInboundAllowance(tier, 999_999).allowed).toBe(true);
    }
  });

  it("points at the next plan that actually raises the ceiling", () => {
    expect(inboundUpgradeTier("free")).toBe("starter");
    expect(inboundUpgradeTier("starter")).toBe("pro");
    expect(inboundUpgradeTier("pro")).toBeNull();
    expect(inboundUpgradeTier("premium")).toBeNull();
  });
});
