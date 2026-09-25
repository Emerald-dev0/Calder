/**
 * Ingest-time quota enforcement (Phase 2 / M2.2).
 *
 * PRICING §5: hard limits, no silent overages — exhaustion answers
 * `plan_limit_reached` with limit, usage and reset time, plus an upgrade
 * pointer. Test-key traffic is never metered or limited; the internal org
 * (Calder's own confirmation/auth mail) is never throttled by its own
 * platform (waitlist confirmations must always send).
 */

import { AppError } from "../errors/index.js";
import { planEmailsLimit, PLAN_LIMITS, type UsagePeriod } from "@calder/config";
import { orgAcceptedLiveInPeriod, orgUsagePeriod, resolveOrgTier, type DbClient } from "@calder/db";

export const INTERNAL_ORG_ID = "org_avenor";

export interface QuotaDecision {
  allowed: boolean;
  tier: string;
  limit: number | null;
  usage: number;
  period: UsagePeriod;
  reason?: "test-env" | "internal-org" | "unlimited-tier";
}

/**
 * Decide whether `organizationId` may accept `incoming` more live sends now
 * (default 1). Counts already-accepted live rows in the current period, so
 * queued mail counts too — bursting past the cap while mail is in flight is
 * not possible.
 */
export async function checkSendQuota(
  db: DbClient,
  organizationId: string,
  env: "test" | "live",
  incoming = 1
): Promise<QuotaDecision> {
  const period = await orgUsagePeriod(db, organizationId);
  if (env === "test") {
    return { allowed: true, tier: "n/a", limit: null, usage: 0, period, reason: "test-env" };
  }
  if (organizationId === INTERNAL_ORG_ID) {
    return { allowed: true, tier: "internal", limit: null, usage: 0, period, reason: "internal-org" };
  }
  const [tier, usage] = await Promise.all([
    resolveOrgTier(db, organizationId),
    orgAcceptedLiveInPeriod(db, organizationId, period),
  ]);
  const limit = planEmailsLimit(tier);
  if (limit === null) {
    return { allowed: true, tier, limit, usage, period, reason: "unlimited-tier" };
  }
  return { allowed: usage + incoming <= limit, tier, limit, usage, period };
}

/** Throw the PRICING-shaped refusal when the quota gate fails. */
export function assertQuotaAllowed(decision: QuotaDecision, incoming = 1): void {
  if (decision.allowed) return;
  const { limit, usage, tier, period } = decision;
  const display = Object.values(PLAN_LIMITS).find((p) => p.tier === tier)?.displayName ?? tier;
  throw new AppError(
    "plan_limit_reached",
    `The ${display} plan allows ${limit!.toLocaleString("en-US")} emails per billing period; ` +
      `${usage.toLocaleString("en-US")} already used this period. ` +
      `Sending ${incoming} more would exceed the limit.`,
    402,
    {
      limit,
      usage,
      tier,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    },
    `Upgrade at ${process.env.DASHBOARD_URL ?? "https://app.calder.click"}/usage or wait for the period reset at ${period.end.toISOString()}.`
  );
}
