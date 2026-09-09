import { pgTable, text, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { organizationRoleEnum } from "./enums";
import { organizations } from "./organizations";

/**
 * Email-first org invitations. The invitee may not exist yet, so the row keys
 * on email + a hashed token (never the raw token). Accept happens automatically
 * on signup/login email match; expiry is 7 days; accepted rows are kept as audit.
 */
export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: organizationRoleEnum("role").notNull().default("member"),
    tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
    invitedBy: text("invited_by"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitations_org_idx").on(t.organizationId),
    index("invitations_email_idx").on(t.email),
  ]
);

export type OrgInvitation = typeof orgInvitations.$inferSelect;
