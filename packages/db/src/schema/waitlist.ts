import { pgTable, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

/**
 * Early-access waitlist. Public signup — no tenant ownership by design
 * (there is no organization yet). Email unique: one seat per address.
 * referralCode is shown to the user; referredBy stores the code that
 * brought them here. Position is computed, never stored.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    referralCode: varchar("referral_code", { length: 16 }).notNull().unique(),
    referredBy: varchar("referred_by", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("waitlist_created_at_idx").on(t.createdAt),
    index("waitlist_referred_by_idx").on(t.referredBy),
  ]
);

export type WaitlistSignup = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignup = typeof waitlistSignups.$inferInsert;
