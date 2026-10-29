"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  auditLogs,
  organizations,
  plans,
  subscriptions,
  OrganizationSendingStatusIdempotencyConflictError,
  setOrganizationSendingStatus as persistOrganizationSendingStatus,
} from "@calder/db";
import { getDb } from "@calder/db";
import { requireControl } from "@/lib/control/guard";
import { isFounderRole } from "@/lib/control/roles";

const TIERS = ["free", "starter", "pro", "scale"] as const;
const ORGANIZATION_SAFETY_ROLES = new Set(["founder", "platform_admin", "security"]);

/** Founder/security kill-switch. Suspension revokes all project keys atomically. */
export async function setOrganizationSafetyStatus(
  orgId: string,
  status: "active" | "suspended",
  reason: string,
  idempotencyKey: string
): Promise<{ ok: boolean; error?: string; revokedKeyCount?: number }> {
  const ctx = await requireControl();
  if (!ORGANIZATION_SAFETY_ROLES.has(ctx.role)) {
    return { ok: false, error: "Founder or security/platform admin only." };
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 6 || trimmed.length > 500) {
    return { ok: false, error: "A reason between 6 and 500 characters is required." };
  }
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length < 1 ||
    idempotencyKey.length > 255
  ) {
    return { ok: false, error: "A valid sending-safety action key is required." };
  }
  if (status !== "active" && status !== "suspended") {
    return { ok: false, error: "Unsupported organization sending status." };
  }
  try {
    const result = await persistOrganizationSendingStatus(getDb(), {
      organizationId: orgId,
      status,
      actorUserId: ctx.user.userId,
      reason: trimmed,
      idempotencyKey: idempotencyKey.trim(),
    });
    revalidatePath("/control/customers/organizations");
    revalidatePath(`/control/customers/organizations/${orgId}`);
    revalidatePath("/control/security/events");
    return { ok: true, revokedKeyCount: result.revokedKeyCount };
  } catch (err) {
    if (err instanceof Error && err.message === "Organization not found.") {
      return { ok: false, error: "Organization not found." };
    }
    if (err instanceof OrganizationSendingStatusIdempotencyConflictError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}

/**
 * Founder/operator action: set an organization's plan by cancelling any
 * active subscription and opening a new one for `months`, starting now.
 * Explicit duration, no hidden renewals, every change audit-logged.
 */
export async function setSubscription(
  orgId: string,
  planTier: string,
  months: number,
  reason: string,
  idempotencyKey: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireControl();
  // M6.2: plan grants manufacture revenue-side state → founder-only, and
  // every grant carries an explicit reason into the audit record.
  if (!isFounderRole(ctx.role)) {
    return { ok: false, error: "Founder only." };
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 6 || trimmed.length > 500) {
    return {
      ok: false,
      error: "A reason (≥ 6 characters) is required — it lands in the audit log.",
    };
  }
  if (!TIERS.includes(planTier as (typeof TIERS)[number])) {
    return { ok: false, error: "Unknown plan tier." };
  }
  const m = Math.floor(months);
  if (!Number.isInteger(months) || m < 1 || m > 36) {
    return { ok: false, error: "Duration must be 1-36 months." };
  }

  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 255) {
    return { ok: false, error: "A valid plan-grant action key is required." };
  }
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [org] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
      .for("update");
    if (!org) return { ok: false, error: "Organization not found." };
    const [prior] = await tx
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgId),
          eq(auditLogs.action, "subscription.set"),
          sql`${auditLogs.metadata}->>'idempotencyKey' = ${idempotencyKey}`
        )
      )
      .limit(1);
    if (prior) {
      const metadata = prior.metadata as Record<string, unknown> | null;
      if (
        prior.actorUserId !== ctx.user.userId ||
        metadata?.plan !== planTier ||
        metadata?.months !== m ||
        metadata?.reason !== trimmed
      )
        return { ok: false, error: "Action key was already used for a different plan grant." };
      return { ok: true };
    }
    const [plan] = await tx
      .select()
      .from(plans)
      .where(eq(plans.tier, planTier as (typeof TIERS)[number]))
      .limit(1);
    if (!plan) return { ok: false, error: "Plan tier not seeded. Run db:seed." };

    await tx
      .update(subscriptions)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")));
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + m);
    const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await tx.insert(subscriptions).values({
      id,
      organizationId: orgId,
      planId: plan.id,
      status: "active",
      currentPeriodStart: start,
      currentPeriodEnd: end,
    });
    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: orgId,
      actorUserId: ctx.user.userId,
      action: "subscription.set",
      targetType: "subscription",
      targetId: id,
      metadata: { plan: planTier, months: m, reason: trimmed, idempotencyKey },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  revalidatePath("/control");
  revalidatePath("/control/billing");
  revalidatePath("/control/customers/organizations");
  revalidatePath(`/control/customers/organizations/${orgId}`);
  return { ok: true };
}
