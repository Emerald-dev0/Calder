import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * The SES account suppression list, mirrored locally.
 *
 * SES keeps its own account-level suppression list and refuses (or silently
 * drops) mail to an address on it. That list is the authority — it is
 * maintained by AWS from bounces and complaints, and it applies to every
 * identity in the account, not to one project or one customer.
 *
 * Before this table, Calder's decision was purely local: a row in `suppressions`
 * for a project. So there were two ways to send to an address SES had already
 * suppressed:
 *
 *   - a bounce recorded by a *different* sender/identity that we never received
 *     a feedback notification for (or received for another environment), and
 *   - any address suppressed while our own pipeline was not the thing that
 *     observed the bounce (e.g. suppression added in the AWS console, or by a
 *     previous deployment of this same account).
 *
 * Mirroring fixes the second-order problem the local table cannot solve: the
 * delivery guard now has an account-wide source, so `findBlockingSuppression`
 * blocks these addresses on every project without an API call per send. The
 * live read-through in the delivery path still consults SES itself, because a
 * mirror is by definition behind.
 *
 * `reason` mirrors SES's vocabulary (`BOUNCE` / `COMPLAINT`) rather than our
 * own, so a row can never be mistaken for a Calder-authored suppression.
 */
export const sesSuppressions = pgTable(
  "ses_suppressions",
  {
    /** Lowercased recipient address — SES keys suppression by address only. */
    email: varchar("email", { length: 320 }).primaryKey(),
    /** `BOUNCE` | `COMPLAINT`, as reported by SES. */
    reason: text("reason").notNull(),
    /** When SES last updated the entry (their `LastUpdateTime`). */
    lastUpdateTime: timestamp("last_update_time", { withTimezone: true }),
    /** When this mirror first learned about the address. */
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** When a reconcile or a live check last confirmed it. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * How this row arrived: `reconcile` (periodic listing), `delivery`
     * (live read-through refused a send) or `feedback` (SES notification).
     * Kept because "we blocked you because of a bounce we just saw" and "we
     * blocked you because a nightly job found it" are different stories.
     */
    source: text("source")
      .notNull()
      .default(sql`'reconcile'`),
  },
  (t) => [index("ses_suppressions_last_seen_idx").on(t.lastSeenAt)]
);

export type SesSuppression = typeof sesSuppressions.$inferSelect;
