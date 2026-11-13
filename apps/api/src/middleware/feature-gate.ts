import type { MiddlewareHandler } from "hono";
import {
  featureAvailability,
  featureDisabledMessage,
  type FeatureId,
} from "@calder/config/features";
import { AppError } from "../errors/index.js";
import type { Env } from "../app.js";

/**
 * Server-side feature gate.
 *
 * Hiding a navigation item is presentation, not enforcement. Any completed
 * workflow whose product is not launched must refuse at the API boundary, or
 * a direct `curl` reaches a half-built feature that the dashboard pretends
 * does not exist.
 *
 * The decision comes from `@calder/config/features`, so the dashboard, the
 * public site and this middleware cannot drift apart: a feature that is not
 * `ready` returns `403 feature_not_available` for every caller, including the
 * organization that owns the data. Existing rows and code are left untouched —
 * disabling a workflow is not deleting it.
 *
 * `requireFeature` is deliberately plan-agnostic: the features it currently
 * guards are excluded from the MVP for *everyone*, not restricted to a tier.
 * Plan-based limits live in `@calder/db`'s quota/resource checks, which are a
 * different question and must not be confused with this one.
 */
/**
 * Refuse a feature that is not launched, from inside a handler.
 *
 * `requireFeature` guards a whole mount point. Some features live inside a
 * route that also serves launched workflows — Gmail is one branch of
 * `POST /v1/senders`, not the whole route — so the same decision has to be
 * assertable at that branch. Identical code, identical error, so a customer
 * cannot tell which mechanism refused them.
 */
export function assertFeatureAvailable(id: FeatureId): void {
  const availability = featureAvailability(id, null);
  if (availability.available) return;
  throw new AppError(
    "feature_not_available",
    featureDisabledMessage(id),
    403,
    { feature: id, status: availability.status },
    "See docs/MVP-FEATURE-MATRIX.md for what is included in this release."
  );
}

export function requireFeature(id: FeatureId): MiddlewareHandler<Env> {
  const availability = featureAvailability(id, null);
  if (availability.available) {
    // A ready feature gets no middleware at all; keeping the call site uniform
    // means flipping the registry is the only change needed to launch it.
    return async (_c, next) => {
      await next();
    };
  }
  return async () => {
    assertFeatureAvailable(id);
  };
}
