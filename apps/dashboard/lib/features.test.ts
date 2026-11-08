import { describe, expect, it } from "vitest";
import {
  COMING_SOON_NAV,
  assertDashboardFeature,
  dashboardFeature,
  isDashboardFeatureAvailable,
} from "./features";

/**
 * The sidebar and the pages must agree with the registry, not with a badge
 * someone typed next to a nav item. These assertions are the anti-drift layer
 * between a Coming Soon label and a working link.
 */
describe("dashboard feature availability", () => {
  it("marks every disabled nav destination as genuinely unavailable", () => {
    expect(COMING_SOON_NAV.length).toBeGreaterThan(0);
    for (const entry of COMING_SOON_NAV) {
      const availability = dashboardFeature(entry.feature);
      expect(availability.available, `${entry.href} must not be usable`).toBe(false);
      expect(availability.reason).toBe("coming_soon");
    }
  });

  it("keeps the MVP surfaces available", () => {
    for (const feature of [
      "email_templates",
      "transactional_email",
      "sender_identities",
      "domains",
      "delivery_logs",
      "suppression_management",
      "webhooks",
      "usage_overview",
      "audit_logs",
    ] as const) {
      expect(isDashboardFeatureAvailable(feature), feature).toBe(true);
    }
  });

  it("does not expose inbound email or SMTP as active", () => {
    expect(isDashboardFeatureAvailable("inbound_email")).toBe(false);
    expect(isDashboardFeatureAvailable("smtp_gateway")).toBe(false);
  });

  it("refuses a server action for a non-launched feature", () => {
    expect(() => assertDashboardFeature("broadcasts")).toThrow(/coming soon/i);
    expect(() => assertDashboardFeature("audiences")).toThrow(/coming soon/i);
    // ...and permits a live one.
    expect(() => assertDashboardFeature("email_templates")).not.toThrow();
  });

  it("never reports a plan upgrade as the fix for an unbuilt feature", () => {
    // Advanced analytics was sold gate on Pro; it is not implemented, so its
    // reason must be coming_soon, not plan_required.
    expect(dashboardFeature("advanced_analytics").reason).toBe("coming_soon");
  });
});
