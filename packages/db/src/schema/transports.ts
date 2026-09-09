import {
 pgTable,
 text,
 timestamp,
 varchar,
 jsonb,
 boolean,
 integer,
 index,
 uniqueIndex,
} from "drizzle-orm/pg-core";
import { transportTypeEnum, transportStatusEnum } from "./enums";
import { projects } from "./projects";

/**
 * Sending transports per project. A project delivers through its default
 * ACTIVE transport; the API key, logs, templates, and events never change
 * when the transport does, that is the graduation path (Gmail → domain →
 * managed infrastructure) made concrete.
 *
 * Credentials are AES-256-GCM encrypted JSON (e.g. Gmail refresh token);
 * decrypt only at send time, never log, never return to clients.
 */
export const projectTransports = pgTable(
 "project_transports",
 {
 id: text("id").primaryKey(),
 projectId: text("project_id")
 .notNull()
 .references(() => projects.id, { onDelete: "cascade" }),
 type: transportTypeEnum("type").notNull(),
 status: transportStatusEnum("status").notNull().default("active"),
 // Human label: Gmail address, SES region, etc. Never a secret.
 label: varchar("label", { length: 320 }).notNull(),
 encryptedCredentials: jsonb("encrypted_credentials").$type<{
 iv: string;
 ciphertext: string;
 tag: string;
 } | null>(),
 // Max sends per UTC day through this transport. NULL = provider default.
 dailyCap: integer("daily_cap"),
 isDefault: boolean("is_default").notNull().default(false),
 lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
 createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
 updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
 },
 (t) => [
 index("transports_project_idx").on(t.projectId),
 uniqueIndex("transports_project_type_label_unique").on(t.projectId, t.type, t.label),
 ]
);

export type ProjectTransport = typeof projectTransports.$inferSelect;
export type NewProjectTransport = typeof projectTransports.$inferInsert;
