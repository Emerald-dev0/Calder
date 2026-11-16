import { pgTable, text, timestamp, varchar, jsonb, integer, index } from "drizzle-orm/pg-core";
import { platformRoleEnum } from "./enums.js";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // e.g., usr_xxx or cuid
    email: varchar("email", { length: 320 }).notNull().unique(),
    name: varchar("name", { length: 255 }),
    // Profile onboarding: who they are, chosen handle, how they found us.
    username: varchar("username", { length: 39 }).unique(),
    role: varchar("role", { length: 32 }),
    referralSource: varchar("referral_source", { length: 100 }),
    discoveryDetail: varchar("discovery_detail", { length: 100 }),
    projectTypes: jsonb("project_types").$type<string[]>(),
    primaryGoal: varchar("primary_goal", { length: 50 }),
    onboardingState: varchar("onboarding_state", { length: 32 }).notNull().default("not_started"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    // Control Plane role. NULL = ordinary customer (no platform access).
    platformRole: platformRoleEnum("platform_role"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    // M6.1 progressive login lockout (ADR-040): consecutive failures raise a
    // temporary lock; success clears both fields.
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    imageUrl: text("image_url"),
    /**
     * Account deletion, with the same grace window as a workspace (F-08).
     * Confirmed against the account's own email address, purged by the sweep.
     */
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletionScheduledFor: timestamp("deletion_scheduled_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("users_deletion_scheduled_idx").on(t.deletionScheduledFor)]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
