import { pgTable, text, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { platformRoleEnum } from "./enums";

export const users = pgTable("users", {
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
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
