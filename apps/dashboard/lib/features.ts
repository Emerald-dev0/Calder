import {
  featureAvailability,
  featureDisabledMessage,
  type FeatureAvailability,
  type FeatureId,
} from "@calder/config/features";

/**
 * Dashboard-side access to the feature registry.
 *
 * Server actions are public HTTP endpoints in Next.js: a page that renders a
 * Coming Soon card is not a guard, because a crafted POST still reaches the
 * exported action. Every action belonging to a non-launched feature must call
 * `assertDashboardFeature` before touching data.
 *
 * This module deliberately takes no tier: the features it protects are absent
 * from the MVP for every plan. Plan-based limits are enforced in `@calder/db`
 * against `@calder/config/plan-limits`, which is a different question.
 */
export function dashboardFeature(id: FeatureId): FeatureAvailability {
  return featureAvailability(id, null);
}

export function isDashboardFeatureAvailable(id: FeatureId): boolean {
  return dashboardFeature(id).available;
}

/**
 * Throw from a server action when its feature is not launched.
 *
 * The message is customer-safe and matches the API's `403
 * feature_not_available` wording, so a user who bypasses the UI sees the same
 * explanation the product gives everywhere else.
 */
export function assertDashboardFeature(id: FeatureId): void {
  if (!isDashboardFeatureAvailable(id)) {
    throw new Error(featureDisabledMessage(id));
  }
}

/**
 * Nav destinations that must render disabled. Kept here (not in the shell) so
 * a test can assert the sidebar cannot drift from the registry.
 */
export const COMING_SOON_NAV: ReadonlyArray<{ href: string; feature: FeatureId }> = [
  { href: "/broadcasts", feature: "broadcasts" },
  { href: "/audiences", feature: "audiences" },
  { href: "/inbox", feature: "inbound_email" },
  { href: "/smtp", feature: "smtp_gateway" },
  { href: "/analytics", feature: "advanced_analytics" },
];
