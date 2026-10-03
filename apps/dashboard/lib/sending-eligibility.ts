import { PLAN_LIMITS } from "@calder/config";
import type { OrganizationSendingDecision } from "@calder/db";

/** Dashboard wording follows the existing quota UI, while safety rules stay private. */
export function assertDashboardAdmissionAllowed(decision: OrganizationSendingDecision): void {
  if (decision.allowed) return;
  if (decision.reason === "plan_quota" && decision.quota) {
    const { limit, usage, tier, period } = decision.quota;
    const display =
      Object.values(PLAN_LIMITS).find((plan) => plan.tier === tier)?.displayName ?? tier;
    throw new Error(
      `Plan limit reached: the ${display} plan allows ${limit!.toLocaleString("en-US")} emails ` +
        `per period; ${usage.toLocaleString("en-US")} used already. ` +
        `Usage resets ${period.end.toISOString().slice(0, 10)} — upgrade on the Usage page to send now.`
    );
  }
  throw new Error("Sending is currently unavailable for this organization.");
}
