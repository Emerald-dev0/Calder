import {
  pgTable,
  text,
  timestamp,
  varchar,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users";

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

/**
 * Magic-link tokens. Only the sha256 hash is stored; the raw token exists
 * solely inside the emailed URL. Single-use (consumed_at), short-lived.
 */
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("magic_link_email_idx").on(t.email)]
);

export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;

/**
 * Email OTP challenges for password signup verification and password reset.
 * Platform-scoped (no project column), short-lived (10 min), max 5 attempts.
 * Stored as sha256 hash of the 6-digit code.
 */
export const emailCodeChallenges = pgTable(
  "email_code_challenges",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: varchar("purpose", { length: 32 }).notNull(), // 'verification' | 'reset'
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_code_challenges_email_idx").on(t.email)]
);

export type EmailCodeChallenge = typeof emailCodeChallenges.$inferSelect;
export type NewEmailCodeChallenge = typeof emailCodeChallenges.$inferInsert;
