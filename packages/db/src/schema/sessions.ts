import { pgTable, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * OAuth identities. One row per (provider, provider-user). Login links by
 * verified email; this table is the link record, not the identity decision.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_provider_user_unique").on(t.provider, t.providerUserId),
    index("oauth_user_idx").on(t.userId),
  ]
);

/**
 * Opaque server-side sessions. The cookie holds only a sealed session id
 * (iron-session); everything else lives here and can be revoked instantly.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;
