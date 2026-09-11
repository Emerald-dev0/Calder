import {
  pgTable,
  text,
  timestamp,
  varchar,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { projectTransports } from "./transports";
import { senderStatusEnum, senderTypeEnum } from "./enums";

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
    isDefault: boolean("is_default").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("senders_project_idx").on(t.projectId),
    uniqueIndex("senders_project_email_unique").on(t.projectId, t.email),
  ]
);

export type SenderIdentity = typeof senderIdentities.$inferSelect;
export type NewSenderIdentity = typeof senderIdentities.$inferInsert;
