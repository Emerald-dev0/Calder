import { notFound } from "next/navigation";
import type { FeatureId } from "@calder/config/features";
import { isDashboardFeatureAvailable } from "./features";

/**
 * A page belonging to an unlaunched feature must 404.
 *
 * Greying the nav item is presentation: the URL is still there, still
 * bookmarkable, still linkable from a support reply, and still reachable by
 * anyone who types it. Rendering a half-built surface under those conditions
 * means the product is judged on a feature that is explicitly not ready, and it
 * implies a capability the deployment does not have. A 404 says the truth: this
 * is not part of the product yet.
 *
 * Server actions are a separate question — they are public endpoints, so they
 * keep calling `assertDashboardFeature` (see `./features.ts`). Gating the page
 * does not gate the action, and vice versa.
 */
export function requireDashboardFeaturePage(id: FeatureId): void {
  if (!isDashboardFeatureAvailable(id)) notFound();
}
