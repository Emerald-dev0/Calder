/**
 * Ingest-time quota enforcement.
 *
 * The database package owns the shared organization quota decision so the API,
 * dashboard and any future admission path use the same policy. The email
 * ledger remains the exactly-once provider-accept meter; this helper only
 * checks already-accepted live email rows before admission.
 */

import { AppError } from "../errors/index.js";
import { PLAN_LIMITS, type UsagePeriod } from "@calder/config";
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
