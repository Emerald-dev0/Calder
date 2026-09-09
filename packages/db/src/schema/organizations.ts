import { pgTable, text, timestamp, varchar, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizationRoleEnum } from "./enums";
import { users } from "./users";

export const organizations = pgTable("organizations", {
 id: text("id").primaryKey(),
 name: varchar("name", { length: 255 }).notNull(),
 slug: varchar("slug", { length: 100 }).notNull().unique(),
 createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
 "organization_members",
 {
 id: text("id").primaryKey(),
 organizationId: text("organization_id")
 .notNull()
 .references(() => organizations.id, { onDelete: "cascade" }),
 userId: text("user_id")
 .notNull()
 .references(() => users.id, { onDelete: "cascade" }),
 role: organizationRoleEnum("role").notNull().default("member"),
 createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
 },
 (t) => [
 uniqueIndex("org_members_org_user_unique").on(t.organizationId, t.userId),
 index("org_members_user_idx").on(t.userId),
 ]
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
