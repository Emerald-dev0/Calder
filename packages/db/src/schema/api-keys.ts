import { pgTable, text, timestamp, varchar, index } from "drizzle-orm/pg-core";
import { apiKeyEnvEnum } from "./enums.js";
import { projects } from "./projects.js";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // prefix like calder_sk_test_ / calder_pk_live_ prefix fragment for identification
    keyPrefix: varchar("key_prefix", { length: 32 }).notNull(),
    // full = manage everything; send = sends only; read = reads only.
    // Existing keys read back as full.
    scope: varchar("scope", { length: 16 }).notNull().default("full"),
    // hashed secret using SHA-256 hex (or bcrypt variant), never raw
    keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
    env: apiKeyEnvEnum("env").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_project_idx").on(t.projectId), index("api_keys_hash_idx").on(t.keyHash)]
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
