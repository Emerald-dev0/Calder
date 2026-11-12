import type { DeliveryEventHealth } from "@calder/observability";

/**
 * Readiness wording for delivery feedback.
 *
 * Split out of the route so the mapping (which states are healthy, which are
 * degraded, and the sentence attached) is testable without a database, and so
 * the same states cannot be mapped two different ways in two places.
 *
 * It is deliberately NOT a readiness *gate*: the API answers requests whether
 * or not SES reports back. A degraded delivery_events check means "do not
 * trust a zero on a dashboard", which is a product truth, not an outage.
 */
export interface DeliveryEventsCheck {
  state: "ok" | "degraded";
  detail: string;
  /**
   * Whether `SES_SNS_TOPIC_ARNS` is set. Surfaced because it is the one fact
   * an operator needs before subscribing a topic to this endpoint, and it was
   * being computed and then thrown away here: `scripts/ses-wiring.mjs
   * subscribe` gates on it, so a missing field read as "not configured"
   * forever and the command could never run.
   */
  configured: boolean;
}

export function deliveryEventsCheck(health: DeliveryEventHealth): DeliveryEventsCheck {
  return {
    state: health.state === "fresh" || health.state === "idle" ? "ok" : "degraded",
    detail: `${health.headline} ${health.detail}`,
    configured: health.configured,
  };
}
