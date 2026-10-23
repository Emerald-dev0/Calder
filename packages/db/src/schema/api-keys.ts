import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { apiKeyEnvEnum } from "./enums.js";
import { projects } from "./projects.js";
import { senderIdentities } from "./senders.js";

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

/**
 * Optional sender restriction for an API key. A join table rather than a jsonb
 * array of ids: the foreign keys delete a revoked sender's grant automatically
 * and make "which keys may use this sender" an indexed lookup, neither of which
 * a jsonb array can do without application-side reconciliation.
 *
 * No rows for a key means unrestricted, which preserves today's behaviour.
 */
export const apiKeySenders = pgTable(
  "api_key_senders",
  {
    id: text("id").primaryKey(), // aks_...
    // CASCADE: the grant has no meaning once the key is deleted.
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    // CASCADE: revoking a sender revokes it from every key that could use it.
    senderId: text("sender_id")
      .notNull()
      .references(() => senderIdentities.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_key_senders_key_sender_unique").on(t.apiKeyId, t.senderId),
    index("api_key_senders_sender_idx").on(t.senderId),
  ]
);

export const apiKeySendersRelations = relations(apiKeySenders, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [apiKeySenders.apiKeyId], references: [apiKeys.id] }),
  sender: one(senderIdentities, {
    fields: [apiKeySenders.senderId],
    references: [senderIdentities.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeySender = typeof apiKeySenders.$inferSelect;
export type NewApiKeySender = typeof apiKeySenders.$inferInsert;
