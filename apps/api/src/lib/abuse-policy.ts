export interface AbusePolicy {
  minimumSends: number;
  bounceRateThreshold: number;
  complaintRateThreshold: number;
}

export interface AbuseMetrics {
  sentCount: number;
  permanentBounceCount: number;
  complaintCount: number;
}

export interface AbuseEvaluation extends AbuseMetrics {
  bounceRate: number;
  complaintRate: number;
  eligible: boolean;
  pause: boolean;
  signals: Array<"permanent_bounce_rate" | "complaint_rate">;
}

/**
 * Explainable deterministic rule over a recent accepted-send denominator.
 * A threshold of zero disables that signal; a too-small denominator never
 * pauses an organization regardless of the observed rates.
 */
export function evaluateOrganizationAbusePolicy(
  metrics: AbuseMetrics,
  policy: AbusePolicy
): AbuseEvaluation {
  const sentCount = Math.max(0, Math.floor(metrics.sentCount));
  const permanentBounceCount = Math.max(0, Math.floor(metrics.permanentBounceCount));
  const complaintCount = Math.max(0, Math.floor(metrics.complaintCount));
  const bounceRate = sentCount > 0 ? permanentBounceCount / sentCount : 0;
  const complaintRate = sentCount > 0 ? complaintCount / sentCount : 0;
  const eligible = sentCount >= policy.minimumSends;
  const signals: AbuseEvaluation["signals"] = [];
  if (eligible && policy.bounceRateThreshold > 0 && bounceRate >= policy.bounceRateThreshold) {
    signals.push("permanent_bounce_rate");
  }
  if (
    eligible &&
    policy.complaintRateThreshold > 0 &&
    complaintRate >= policy.complaintRateThreshold
  ) {
    signals.push("complaint_rate");
  }
  return {
    sentCount,
    permanentBounceCount,
    complaintCount,
    bounceRate,
    complaintRate,
    eligible,
    pause: signals.length > 0,
    signals,
  };
}
