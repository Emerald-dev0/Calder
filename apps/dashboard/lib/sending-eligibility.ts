import { planDisplayName } from "@calder/config";
import type { OrganizationSendingDecision } from "@calder/db";

/** Dashboard wording follows the existing quota UI, while safety rules stay private. */
export function assertDashboardAdmissionAllowed(decision: OrganizationSendingDecision): void {
  if (decision.allowed) return;
  if (decision.reason === "plan_quota" && decision.quota) {
    const { limit, usage, tier, period } = decision.quota;
    const display = planDisplayName(tier);
    if (decision.quota.window === "daily") {
      throw new Error(
        `Daily limit reached: the ${display} plan allows ${limit!.toLocaleString("en-US")} accepted live emails per UTC day; ${usage.toLocaleString("en-US")} used. Resets ${period.end.toISOString()}.`
      );
    }
    throw new Error(
      `Plan limit reached: the ${display} plan allows ${limit!.toLocaleString("en-US")} emails ` +
        `per period; ${usage.toLocaleString("en-US")} used already. ` +
        `Usage resets ${period.end.toISOString().slice(0, 10)}.`
    );
  }
  throw new Error("Sending is currently unavailable for this organization.");
}
