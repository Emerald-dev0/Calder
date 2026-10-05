import { pgTable, text, timestamp, varchar, uniqueIndex, index } from "drizzle-orm/pg-core";
import { organizationRoleEnum, organizationSendingStatusEnum } from "./enums.js";
import { users } from "./users.js";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  // One canonical org-level sending state shared by every project and key.
  // abuse_paused is an automatic feedback response; suspended is operator-set.
  sendingStatus: organizationSendingStatusEnum("sending_status").notNull().default("active"),
  sendingStatusReason: text("sending_status_reason"),
  sendingStatusAt: timestamp("sending_status_at", { withTimezone: true }),
  sendingStatusActorUserId: text("sending_status_actor_user_id"),
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
