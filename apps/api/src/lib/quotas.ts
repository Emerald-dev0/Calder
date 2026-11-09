/**
 * Ingest-time quota enforcement.
 *
 * The database package owns the shared organization quota decision so the API,
 * dashboard and any future admission path use the same policy. The email
 * ledger remains the exactly-once provider-accept meter; this helper only
 * checks already-accepted live email rows before admission.
 */

import { AppError } from "../errors/index.js";
import { planDisplayLabel, type UsagePeriod } from "@calder/config";
import {
  checkOrganizationQuota,
  INTERNAL_ORGANIZATION_ID,
  type DbClient,
  type OrganizationQuotaDecision,
} from "@calder/db";

export const INTERNAL_ORG_ID = INTERNAL_ORGANIZATION_ID;

export interface QuotaDecision extends OrganizationQuotaDecision {
  period: UsagePeriod;
}

/** Shared org-level quota calculation (test/internal exemptions included). */
export function checkSendQuota(
  db: DbClient,
  organizationId: string,
  env: "test" | "live",
  incoming = 1
): Promise<QuotaDecision> {
  return checkOrganizationQuota(db, organizationId, env, incoming);
}

/** Throw the PRICING-shaped refusal when the quota gate fails. */
export function assertQuotaAllowed(decision: QuotaDecision, incoming = 1): void {
  if (decision.allowed) return;
  const { limit, usage, tier, period } = decision;
  // Display names come from the catalogue, never from the raw database value.
  const display = planDisplayLabel(tier);
  if (decision.window === "daily") {
    throw new AppError(
      "plan_limit_reached",
      `The ${display} plan allows ${limit!.toLocaleString("en-US")} accepted live emails per UTC day; ${usage.toLocaleString("en-US")} already accepted. Sending ${incoming} more would exceed the daily limit.`,
      402,
      {
        limit,
        usage,
        tier,
        window: "daily",
        dailyLimit: decision.dailyLimit ?? limit,
        burstCapacity: decision.burstCapacity ?? 0,
        dailyCapacity: decision.dailyCapacity ?? limit,
        passAvailable: decision.passAvailable ?? true,
        creditsAvailable: decision.creditsAvailable ?? 0,
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      },
      decision.passAvailable
        ? `Buy a Daily Burst Pass to add ${(1000).toLocaleString("en-US")} submissions for the rest of today, or wait for the reset at ${period.end.toISOString()}. A pass never adds monthly credits.`
        : `The Daily Burst Pass limit for today has been reached. Wait for the reset at ${period.end.toISOString()}.`
    );
  }
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
      window: "billing_period",
      creditUnitsRequired: decision.creditUnits ?? 0,
      creditsAvailable: decision.creditsAvailable ?? 0,
      creditsExhausted: (decision.creditUnits ?? 0) > (decision.creditsAvailable ?? 0),
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
    },
    (decision.creditUnits ?? 0) > 0
      ? `Purchase prepaid credits to cover ${(decision.creditUnits ?? 0).toLocaleString("en-US")} more emails, or wait for the period reset at ${period.end.toISOString()}.`
      : `Wait for the period reset at ${period.end.toISOString()}.`
  );
}
