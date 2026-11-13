/**
 * The maintenance sweep: work that has to happen on a clock rather than an
 * incoming request.
 *
 * Three jobs, all idempotent, all safe to overlap:
 *  - credits that reached their expiry date stop being spendable;
 *  - processor leases held by an invocation that died are released, so the
 *    work is retried instead of being stranded until someone notices;
 *  - payments that are still `pending` well after checkout are re-verified
 *    with the provider, because a webhook can be lost and the customer's money
 *    has already moved.
 *
 * It lives here, not in the route, because **two** entry points run it: the
 * manual `/v1/cron/maintenance` endpoint and the scheduled `/v1/cron/drain`
 * tick. Vercel Hobby allows two cron jobs per project and both are already
 * spent — one on delivery, one on company mail — so the daily sweep rides the
 * delivery tick instead of getting a schedule of its own. Splitting this out
 * is what makes that folding copy-paste-free and testable.
 */
import { and, eq, lt } from "drizzle-orm";
import { expireCredits, payments, reapExpiredLeases, type DbClient } from "@calder/db";
import { verifyAndFulfil } from "../services/billing.js";

export interface MaintenanceSummary {
  expiredCreditPurchases: number;
  reapedLeases: number;
  /** Pending payments older than the grace window that were checked. */
  reconciled: number;
  reconcileFailed: number;
  /** True when Paystack is not configured, so no reconciliation was attempted. */
  reconciliationSkipped: boolean;
}

/** Payments are re-checked only after this long, so an in-flight checkout is left alone. */
const RECONCILE_AFTER_MS = 30 * 60 * 1000;

/** Bounded so one tick cannot spend its whole budget on a backlog. */
const RECONCILE_LIMIT = 10;

export async function runScheduledMaintenance(
  db: DbClient,
  now: Date = new Date()
): Promise<MaintenanceSummary> {
  const expiredCreditPurchases = await expireCredits(db, now);
  const reapedLeases = await reapExpiredLeases(db);

  // Reconciliation talks to the provider, so it needs credentials. Without
  // them the sweep still runs: credit expiry and lease reaping are local.
  const canReconcile =
    Boolean(process.env.PAYSTACK_SECRET_KEY) && process.env.PAYSTACK_USD_ENABLED === "true";
  let reconciled = 0;
  let reconcileFailed = 0;

  if (canReconcile) {
    const stale = await db
      .select({ reference: payments.reference })
      .from(payments)
      .where(
        and(
          eq(payments.status, "pending"),
          lt(payments.createdAt, new Date(now.getTime() - RECONCILE_AFTER_MS))
        )
      )
      .limit(RECONCILE_LIMIT);

    for (const row of stale) {
      try {
        await verifyAndFulfil(db, row.reference);
        reconciled++;
      } catch {
        // A payment that verifies as failed, mismatched or unknown stays
        // exactly as it was; a human reads it on the billing page. Counting it
        // instead of throwing keeps the rest of the sweep running.
        reconcileFailed++;
      }
    }
  }

  return {
    expiredCreditPurchases,
    reapedLeases,
    reconciled,
    reconcileFailed,
    reconciliationSkipped: !canReconcile,
  };
}
