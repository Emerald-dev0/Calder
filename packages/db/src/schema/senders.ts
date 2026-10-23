import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { projectTransports } from "./transports.js";
import { senderStatusEnum, senderTypeEnum } from "./enums.js";

/**
 * Sender identities: the named, scoped, verifiable "who" behind a send.
 * Scoped to a project (environment rides project metadata, ADR Phase-1
 * adaptation). The application sends `sender_xxx`; the backend resolves it
 * to an address + transport. Never a bare From string.
 */
export const senderIdentities = pgTable(
  "sender_identities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    type: senderTypeEnum("type").notNull(),
    // Preferred transport for this sender. NULL = project default at send
    // time. Never a secret; credentials live on the transport row.
    transportId: text("transport_id").references(() => projectTransports.id, {
      onDelete: "set null",
    }),
    status: senderStatusEnum("status").notNull().default("pending"),
    statusReason: varchar("status_reason", { length: 500 }),
    // The transactional default. Kept as-is for compatibility: existing code
    // resolves `isDefault` when a send does not name a sender.
    isDefault: boolean("is_default").notNull().default(false),
    // The marketing (broadcast) default. Separate from `isDefault` so a
    // project can send OTPs from "no-reply" and campaigns from "hello".
    isDefaultMarketing: boolean("is_default_marketing").notNull().default(false),
    // Reply-To override for this identity. NULL = reply to the From address.
    replyTo: varchar("reply_to", { length: 320 }),
    // Archived senders stay for history but are never selectable again.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("senders_project_idx").on(t.projectId),
    uniqueIndex("senders_project_email_unique").on(t.projectId, t.email),
    // At most one live marketing default per project. Partial: archived
    // senders and every sender that is not the default are unconstrained.
    uniqueIndex("senders_project_default_marketing_unique")
      .on(t.projectId)
      .where(sql`"is_default_marketing" = true AND "archived_at" IS NULL`),
  ]
);

export type SenderIdentity = typeof senderIdentities.$inferSelect;
export type NewSenderIdentity = typeof senderIdentities.$inferInsert;
