"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  AbuseReviewError,
  addAbuseReviewNote,
  applyAbuseReviewDecision,
  canEnforceAbuseReview,
  type AbuseReviewAction,
} from "@calder/db";
import { getDb } from "@calder/db";
import { requireControl } from "@/lib/control/guard";

/**
 * Abuse review decisions from the Control Plane.
 *
 * The role gate is here *and* in the page: a reader may look at the queue, but
 * changing a workspace's sending state is founder/platform-admin/security only.
 * The note is required by `@calder/db`; this action refuses early so the refusal
 * is a banner instead of a database error, but the enforcement does not depend
 * on the form having been honest.
 */
export async function applyAbuseReviewAction(formData: FormData): Promise<void> {
  const ctx = await requireControl();
  const organizationId = String(formData.get("organizationId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "");

  const back = (code: string): never =>
    redirect(
      `/control/customers/abuse-review?review=${encodeURIComponent(code)}&org=${encodeURIComponent(organizationId)}`
    );

  if (!canEnforceAbuseReview(ctx.role)) back("forbidden");

  try {
    if (decision === "note") {
      await addAbuseReviewNote(getDb(), {
        organizationId,
        note,
        actorUserId: ctx.user.userId,
      });
    } else if (decision === "reinstate" || decision === "pause" || decision === "suspend") {
      await applyAbuseReviewDecision(getDb(), {
        organizationId,
        action: decision as AbuseReviewAction,
        note,
        actorUserId: ctx.user.userId,
      });
    } else {
      back("unsupported_action");
    }
  } catch (error) {
    if (error instanceof AbuseReviewError) back(error.code);
    back("error");
  }

  revalidatePath("/control/customers/abuse-review");
  revalidatePath("/control/customers/organizations");
  revalidatePath(`/control/customers/organizations/${organizationId}`);
  revalidatePath("/control/security/events");
  back(decision === "note" ? "noted" : "applied");
}
