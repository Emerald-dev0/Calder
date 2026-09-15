import { pgTable, text, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * First-party analytics events (Control Plane growth analytics).
 *
 * Privacy by construction (SECURITY.md / SRS REQ-080):
 * - No PII columns exist: no email, no name, no IP, no free text.
 * - `visitorId`/`sessionId` are random anonymous ids from the browser
 *   (localStorage / sessionStorage), never derived from identity.
 * - `country` is derived server-side from the edge geo header
 *   (country-level only, no region/city from the client).
 * - Retention target: 13 months; purge cron is a documented follow-up.
 */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    /** pageview | cta_click | form_start | form_complete */
    type: varchar("type", { length: 24 }).notNull(),
    /** Page path, e.g. "/pricing". Null for non-page events. */
    path: varchar("path", { length: 512 }),
    /** CTA name, e.g. "join_waitlist", "start_free". Null for pageviews. */
    label: varchar("label", { length: 100 }),
    referrer: varchar("referrer", { length: 512 }),
    /** Acquisition source captured at event time (utm_source or data-source). */
    source: varchar("source", { length: 100 }),
    utm: jsonb("utm").$type<Record<string, string>>(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    visitorId: varchar("visitor_id", { length: 64 }).notNull(),
    /** coarse device class: desktop | mobile | tablet | bot */
    device: varchar("device", { length: 16 }),
    /** ISO 3166 country (from edge header). Null when unknown. */
    country: varchar("country", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("analytics_events_created_idx").on(t.createdAt),
    index("analytics_events_type_created_idx").on(t.type, t.createdAt),
    index("analytics_events_visitor_idx").on(t.visitorId),
    index("analytics_events_session_idx").on(t.sessionId),
    index("analytics_events_path_idx").on(t.path),
  ]
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
