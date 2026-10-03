import type { OrganizationSendingDecision } from "@calder/db";
import { AppError } from "../errors/index.js";
import { assertQuotaAllowed } from "./quotas.js";

/** Translate internal safety decisions to the stable, non-revealing API error. */
export function assertOrganizationAdmissionAllowed(decision: OrganizationSendingDecision): void {
  if (decision.allowed) return;
  if (decision.reason === "plan_quota" && decision.quota) {
    assertQuotaAllowed(decision.quota);
  }
  throw new AppError(
    "organization_sending_unavailable",
    "Sending is currently unavailable for this organization.",
    403
  );
}
