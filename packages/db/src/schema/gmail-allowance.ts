import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Provider-bound Gmail attempts, keyed by a digest of the connected account.
 * Retained independently of projects so disconnecting cannot reset the limit. */
export const gmailSendAttempts = pgTable(
  "gmail_send_attempts",
  {
    id: text("id").primaryKey(),
    accountHash: text("account_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gmail_send_attempts_account_time_idx").on(t.accountHash, t.attemptedAt)]
);
