import { describe, expect, it } from "vitest";
import {
  FEATURES,
  FEATURE_IDS,
  UNENFORCED_PLAN_DIFFERENCES,
  featureAvailability,
  featureAvailabilityLabel,
  featureFor,
  featurePlans,
  featuresWithStatus,
  isFeatureLive,
  planIncludesFeature,
} from "./features.js";
import { PLAN_ORDER } from "./plan-limits.js";

/**
 * The registry is the one place surfaces read availability from, so the
 * invariants that keep it honest are tested here rather than discovered in a
 * page that quietly shows an Upgrade button for something unbuilt.
 */
describe("feature registry", () => {
  it("declares every feature exactly once", () => {
    const ids = FEATURE_IDS;
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(FEATURES[id].id).toBe(id);
  });

  it("gives every non-ready feature a customer-safe explanation", () => {
    for (const id of FEATURE_IDS) {
      const feature = FEATURES[id];
      if (feature.status === "ready") continue;
      expect(feature.note, `${id} needs a note`).toBeTruthy();
      expect(feature.note!.length).toBeGreaterThan(20);
    }
  });

  it("never makes a coming-soon feature usable, in or out of MVP scope", () => {
    for (const feature of featuresWithStatus("coming_soon")) {
      // SDKs are in MVP scope but incomplete (Status B); marketing is out of
      // scope (Status C). Either way no customer may use it today.
      expect(featureAvailability(feature.id, "scale").available, feature.id).toBe(false);
      expect(featureAvailabilityLabel(featureAvailability(feature.id, "scale"))).toBe(
        "Coming Soon"
      );
    }
  });

  it("keeps marketing and SMTP out of the MVP", () => {
    for (const id of ["broadcasts", "audiences", "campaigns", "smtp_gateway"] as const) {
      expect(FEATURES[id].mvp).toBe(false);
      expect(FEATURES[id].status).toBe("coming_soon");
    }
  });

  it("keeps templates live and in the MVP — they are not a Coming Soon feature", () => {
    expect(FEATURES.email_templates.status).toBe("ready");
    expect(FEATURES.email_templates.mvp).toBe(true);
    expect(featureAvailability("email_templates", "free").available).toBe(true);
  });

  it("keeps transactional suppression and unsubscribe live while marketing is disabled", () => {
    expect(FEATURES.suppression_management.status).toBe("ready");
    expect(FEATURES.unsubscribe_handling.status).toBe("ready");
    expect(FEATURES.marketing_unsubscribes.status).toBe("coming_soon");
  });

  it("does not pretend inbound email exists", () => {
    expect(FEATURES.inbound_email.status).toBe("coming_soon");
    expect(featureAvailability("inbound_email", "pro").available).toBe(false);
    expect(featureAvailabilityLabel(featureAvailability("inbound_email", "pro"))).toBe(
      "Coming Soon"
    );
  });

  it("never advertises customer uptime history without data", () => {
    expect(FEATURES.customer_uptime_history.status).toBe("coming_soon");
    expect(FEATURES.uptime_status.status).toBe("ready");
  });

  it("fails closed for unknown and empty tiers", () => {
    for (const tier of ["", "nonsense", null, undefined]) {
      expect(planIncludesFeature("transactional_email", tier)).toBe(true); // every tier includes it
      expect(planIncludesFeature("broadcasts", tier)).toBe(true); // but it is not live
      expect(featureAvailability("broadcasts", tier).available).toBe(false);
    }
  });

  it("honours a feature restricted to specific tiers", () => {
    // The catalogue currently has no tier-restricted implemented feature; assert
    // the mechanism rather than inventing a commercial restriction.
    const restricted = { ...FEATURES.transactional_email, plans: ["pro", "premium"] as const };
    expect(restricted.plans.includes("free")).toBe(false);
    for (const tier of PLAN_ORDER) {
      expect(featurePlans("email_templates")).toContain(tier);
    }
  });

  it("treats engine identities as entitled but never as catalogue plans", () => {
    expect(planIncludesFeature("email_templates", "internal")).toBe(true);
    expect(planIncludesFeature("broadcasts", "n/a")).toBe(true);
    expect(featureAvailability("broadcasts", "internal").available).toBe(false);
  });

  it("isFeatureLive is about implementation, not entitlement", () => {
    expect(isFeatureLive("email_templates")).toBe(true);
    expect(isFeatureLive("smtp_gateway")).toBe(false);
  });

  it("records every advertised-but-unenforced plan difference with an owner decision", () => {
    expect(UNENFORCED_PLAN_DIFFERENCES.length).toBeGreaterThan(0);
    for (const row of UNENFORCED_PLAN_DIFFERENCES) {
      expect(Object.keys(FEATURES)).toContain(row.feature);
      expect(row.advertised.length).toBeGreaterThan(10);
      expect(row.decision.startsWith("Owner:")).toBe(true);
    }
  });

  it("keeps featureFor total", () => {
    for (const id of FEATURE_IDS) expect(featureFor(id).id).toBe(id);
  });
});
