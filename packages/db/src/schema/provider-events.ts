import { jsonb, pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/** Immutable inbox for provider callbacks. The SNS message id is the replay key. */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    topicArn: text("topic_arn"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_events_message_id_unique").on(table.messageId),
    index("provider_events_received_idx").on(table.receivedAt),
  ]
);

export type ProviderEvent = typeof providerEvents.$inferSelect;
export type NewProviderEvent = typeof providerEvents.$inferInsert;
