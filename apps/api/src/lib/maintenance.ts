/**
 * The maintenance sweep: work that has to happen on a clock rather than an
 * incoming request.
 *
 * Six jobs, all idempotent, all safe to overlap:
 *  - credits that reached their expiry date stop being spendable;
 *  - processor leases held by an invocation that died are released, so the
 *    work is retried instead of being stranded until someone notices;
 *  - payments that are still `pending` well after checkout are re-verified
 *    with the provider, because a webhook can be lost and the customer's money
 *    has already moved;
 *  - the SES account suppression list is mirrored, because it is the authority
 *    on who can receive mail and the send path must not pay an API call to ask;
 *  - each plan's retention window is applied, because `retentionDays` was
 *    catalogue data that nothing enforced.
 *
 * It lives here, not in the route, because **two** entry points run it: the
 * manual `/v1/cron/maintenance` endpoint and the scheduled `/v1/cron/drain`
 * tick. Vercel Hobby allows two cron jobs per project and both are already
 * spent — one on delivery, one on company mail — so the daily sweep rides the
 * delivery tick instead of getting a schedule of its own. Splitting this out
 * is what makes that folding copy-paste-free and testable.
 */
import { and, eq, lt } from "drizzle-orm";
import {
  enforceRetention,
  expireCredits,
  payments,
  reapExpiredLeases,
  type DbClient,
  type RetentionSweepSummary,
} from "@calder/db";
import { verifyAndFulfil } from "../services/billing.js";
import {
  reconcileSesSuppressions,
  type SuppressionReconcileSummary,
} from "./ses-suppression-reconcile.js";

export interface MaintenanceSummary {
  expiredCreditPurchases: number;
  reapedLeases: number;
  /** Pending payments older than the grace window that were checked. */
  reconciled: number;
  reconcileFailed: number;
  /** True when Paystack is not configured, so no reconciliation was attempted. */
  reconciliationSkipped: boolean;
  /**
   * The provider's own suppression list, mirrored locally. Reported on every
   * tick because "we did not look" and "we looked and it was empty" must not
   * look the same in a cron log.
   */
  suppressions: SuppressionReconcileSummary;
  /**
   * Each plan's retention window, applied. `truncated` means a bound stopped
   * the run early, so the next tick continues instead of claiming the fleet is
   * clean.
   */
  retention: RetentionSweepSummary;
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

  // SES's suppression list is the authority for deliverability, and the ingest
  // path cannot afford to ask SES per send. Mirroring it here is what keeps the
  // local answer current. Runs whether or not the provider is configured — the
  // summary says which, rather than silently reporting zero.
  const suppressions = await reconcileSesSuppressions(db, { now });

  // Retention is last because it is the only job here that destroys data.
  // Everything above records or repairs; this one redacts message bodies and
  // deletes provider events past each plan's window. Bounded per run, and the
  // summary says when a bound stopped it (`truncated`) so the next tick
  // continues rather than the log claiming the fleet is clean.
  const retention = await enforceRetention(db, now);

  return {
    expiredCreditPurchases,
    reapedLeases,
    reconciled,
    reconcileFailed,
    reconciliationSkipped: !canReconcile,
    suppressions,
    retention,
  };
}
