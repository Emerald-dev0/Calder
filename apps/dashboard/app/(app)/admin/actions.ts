"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, organizations, plans, subscriptions, auditLogs } from "@calder/db";
import { getConfig } from "@calder/config";
import { revalidatePath } from "next/cache";
import { getTenantContext } from "../../../lib/auth";

const TIERS = ["free", "starter", "pro", "scale"] as const;

function isFounder(email: string): boolean {
  const founders = (getConfig().FOUNDER_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return founders.includes(email.toLowerCase());
}

/**
 * Founder-only: cancel any active subscription for an org and open a new one
 * for `months` starting now. Duration is explicit, no hidden renewals.
 */
export async function setSubscription(
  orgId: string,
  planTier: string,
  months: number
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getTenantContext().catch(() => null);
  if (!ctx || !isFounder(ctx.user.email)) return { ok: false, error: "Founder only." };
  if (!TIERS.includes(planTier as (typeof TIERS)[number]))
    return { ok: false, error: "Unknown plan tier." };
  const m = Math.floor(months);
  if (!Number.isFinite(m) || m < 1 || m > 36)
    return { ok: false, error: "Duration must be 1-36 months." };

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
      metadata: { plan: planTier, months: m },
    });
  } catch {
    // Audit must never break the operation it records.
  }
  revalidatePath("/admin");
  return { ok: true };
}
