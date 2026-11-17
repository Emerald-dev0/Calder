import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * "I have seen this" — the memory the Support queue otherwise lacks.
 *
 * The triage queue is derived state: it is recomputed on every render from
 * conditions that are still true. That is the right shape for a queue (nothing
 * to fall out of sync with reality), but it means an item you have already
 * investigated keeps reappearing with no way to say so. Without a record of the
 * look, the only way to clear the page is to fix the underlying condition —
 * impossible for "customer was told, waiting on their DNS".
 *
 * This table stores that look, deliberately narrowly:
 *
 *  - `item_id` is the queue's own stable id (`domain:dom_123`), not a foreign
 *    key. An acknowledgement outlives the row it refers to: a deleted domain
 *    does not erase the fact that someone reviewed it.
 *  - `fingerprint` is the condition as it was when acknowledged. The queue
 *    compares the current item against it; if the evidence changed (a domain
 *    went from pending to failed, a deletion escalated to critical) the item
 *    comes back without waiting for anything.
 *  - `acknowledged_at` is also a clock: an acknowledgement lapses on its own
 *    after the cooldown in `lib/control/acknowledgements`, so "seen" can never
 *    mean "hidden for good". Papering over a real outage takes daily effort,
 *    which is the point.
 *
 * History is append-only. Reopening writes a row update on the newest entry
 * rather than deleting it, so the audit trail shows who acknowledged what and
 * when somebody decided it was not, in fact, fine.
 */
export const triageAcknowledgements = pgTable(
  "triage_acknowledgements",
  {
    id: text("id").primaryKey(),
    /** Queue item id, e.g. `domain:dom_123` or `workspace-paused:org_456`. */
    itemId: varchar("item_id", { length: 200 }).notNull(),
    /** What the item was, so history reads without re-deriving it. */
    kind: varchar("kind", { length: 64 }).notNull(),
    title: text("title").notNull(),
    /** Digest of the condition at the moment it was acknowledged. */
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    /** Why the operator is satisfied; optional but kept when supplied. */
    note: text("note"),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenedByUserId: text("reopened_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "What is the newest acknowledgement for this item" runs per row on every
    // queue render, so the lookup is keyed exactly like the read.
    index("triage_ack_item_idx").on(t.itemId, t.acknowledgedAt),
    index("triage_ack_active_idx").on(t.reopenedAt),
  ]
);

export type TriageAcknowledgement = typeof triageAcknowledgements.$inferSelect;
export type NewTriageAcknowledgement = typeof triageAcknowledgements.$inferInsert;
