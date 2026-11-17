/**
 * Mirror the SES account suppression list into our database.
 *
 * The delivery path asks SES about each recipient, which is the authority but
 * costs an API call per address. The ingest path cannot afford that, so it
 * needs the answer to be already here. This job is how "already here" stays
 * true: it pages through the account list and upserts what it finds.
 *
 * Design decisions worth keeping:
 *
 *  - **Incremental by `LastUpdateTime`.** The watermark is the newest
 *    `last_seen_at` produced by a previous reconcile, minus a one-day overlap.
 *    Overlapping is deliberate: a listing that fails halfway must not skip the
 *    entries it never reached, and re-reading a day is cheap and idempotent.
 *  - **Nothing is deleted.** An entry disappearing from our mirror is not
 *    evidence that AWS removed it — it may be pagination, a transient filter or
 *    a partial run. Removing rows would silently re-open an address to mail.
 *    Clearing a suppression is an operator action in AWS, and the row should
 *    outlive our uncertainty.
 *  - **Bounded.** `maxPages` caps one run so the daily tick cannot spend its
 *    whole budget listing; `truncated` says whether it stopped early so the
 *    next run continues from the new watermark instead of pretending it is done.
 */

import { desc, eq } from "drizzle-orm";
import { getDb, sesSuppressions, type DbClient } from "@calder/db";
import { listSuppressedDestinations } from "@calder/providers";
import { logger } from "@calder/observability";
import { recordAccountSuppression, sesSuppressionCheckConfigured } from "./ses-suppression.js";

export interface SuppressionReconcileSummary {
  /** True when no SES credentials exist, so there was nothing to read. */
  skipped: boolean;
  /** Entries seen from SES in this run. */
  listed: number;
  /** Pages fetched. */
  pages: number;
  /** True when `maxPages` was reached before the listing ended. */
  truncated: boolean;
  failed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PAGES = 5;
const PAGE_SIZE = 1000;
/** Re-read this far back before the watermark, so a partial run cannot skip rows. */
const OVERLAP_MS = DAY_MS;

type Lister = typeof listSuppressedDestinations;

export async function reconcileSesSuppressions(
  db: DbClient = getDb(),
  opts: { now?: Date; maxPages?: number; pageSize?: number; list?: Lister } = {}
): Promise<SuppressionReconcileSummary> {
  if (!sesSuppressionCheckConfigured()) {
    return { skipped: true, listed: 0, pages: 0, truncated: false, failed: false };
  }

  const now = opts.now ?? new Date();
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const list = opts.list ?? listSuppressedDestinations;

  // Watermark: the most recent entry a previous reconcile confirmed.
  const [watermarkRow] = await db
    .select({ lastSeenAt: sesSuppressions.lastSeenAt })
    .from(sesSuppressions)
    .where(eq(sesSuppressions.source, "reconcile"))
    .orderBy(desc(sesSuppressions.lastSeenAt))
    .limit(1);
  const since = watermarkRow?.lastSeenAt
    ? new Date(watermarkRow.lastSeenAt.getTime() - OVERLAP_MS)
    : undefined;

  let listed = 0;
  let pages = 0;
  let nextToken: string | null = null;

  try {
    do {
      const page = await list({ pageSize, nextToken, since });
      pages += 1;
      for (const entry of page.entries) {
        await recordAccountSuppression(db, {
          email: entry.email,
          reason: entry.reason,
          lastUpdateTime: entry.lastUpdateTime,
          source: "reconcile",
          now,
        });
        listed += 1;
      }
      nextToken = page.nextToken;
    } while (nextToken && pages < maxPages);
  } catch (err) {
    // Partial progress is kept: the rows written above are real, and the next
    // run starts from a watermark that has advanced. Reporting `failed` keeps
    // the failure visible in the cron output instead of a silent zero.
    logger.warn(
      { err: err instanceof Error ? err.message : "unknown", pages, listed },
      "SES suppression reconcile failed"
    );
    return { skipped: false, listed, pages, truncated: Boolean(nextToken), failed: true };
  }

  const truncated = Boolean(nextToken);
  if (truncated) {
    logger.info(
      { pages, listed },
      "SES suppression reconcile stopped at the page cap; the next run continues"
    );
  }

  return { skipped: false, listed, pages, truncated, failed: false };
}
