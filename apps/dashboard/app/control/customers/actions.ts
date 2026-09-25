"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, organizations, plans, subscriptions } from "@calder/db";
import { getDb } from "@calder/db";
import { requireControl } from "@/lib/control/guard";
import { isFounderRole } from "@/lib/control/roles";

const TIERS = ["free", "starter", "pro", "scale"] as const;

/**
 * Founder/operator action: set an organization's plan by cancelling any
 * active subscription and opening a new one for `months`, starting now.
 * Explicit duration, no hidden renewals, every change audit-logged.
 */
export async function setSubscription(
  orgId: string,
  planTier: string,
  months: number,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireControl();
  // M6.2: plan grants manufacture revenue-side state → founder-only, and
  // every grant carries an explicit reason into the audit record.
  if (!isFounderRole(ctx.role)) {
    return { ok: false, error: "Founder only." };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 6) {
    return {
      ok: false,
      error: "A reason (≥ 6 characters) is required — it lands in the audit log.",
    };
  }
  if (!TIERS.includes(planTier as (typeof TIERS)[number])) {
    return { ok: false, error: "Unknown plan tier." };
  }
  const m = Math.floor(months);
  if (!Number.isFinite(m) || m < 1 || m > 36) {
    return { ok: false, error: "Duration must be 1-36 months." };
  }

  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return { ok: false, error: "Organization not found." };
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.tier, planTier as (typeof TIERS)[number]))
    .limit(1);
  if (!plan) return { ok: false, error: "Plan tier not seeded. Run db:seed." };

  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")));
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + m);
  const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(subscriptions).values({
    id,
    organizationId: orgId,
    planId: plan.id,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: end,
  });
  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: orgId,
      actorUserId: ctx.user.userId,
      action: "subscription.set",
      targetType: "subscription",
      targetId: id,
      metadata: { plan: planTier, months: m, reason: trimmed },
    });
  } catch {
    // Audit must never break the operation it records.
  }
  revalidatePath("/control");
  revalidatePath("/control/billing");
  revalidatePath("/control/customers/organizations");
  revalidatePath(`/control/customers/organizations/${orgId}`);
  return { ok: true };
}
