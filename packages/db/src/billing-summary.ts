import { eq, sql } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { plans, subscriptions } from "./schema/billing.js";
import { payments } from "./schema/payments.js";

/** Subscription + payment history for dashboard and API billing surfaces. */
export async function billingSummary(db: DbClient, organizationId: string) {
  const [subscription] = await db
    .select({
      status: subscriptions.status,
      tier: plans.tier,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  const history = await db
    .select({
      reference: payments.reference,
      kind: payments.kind,
      amountCents: payments.amountCents,
      currency: payments.currency,
      status: payments.status,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
    })
    .from(payments)
    .where(eq(payments.organizationId, organizationId))
    .orderBy(sql`${payments.createdAt} desc`)
    .limit(50);
  return { subscription: subscription ?? null, history };
}
