import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, varchar, jsonb, index } from "drizzle-orm/pg-core";
import type { ContactStatus } from "./enums.js";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";
import { audiences } from "./audiences.js";

// ── segments.rules JSON shape ────────────────────────────────

/** Comparison operators available on a contact property. */
export type SegmentPropertyOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "in"
  | "exists"
  | "not_exists";

/** A group combines children with AND (all) or OR (any); groups nest freely. */
export interface SegmentGroup {
  operator: "and" | "or";
  conditions: SegmentNode[];
}

/** Anything that can appear inside a group: a condition or a nested group. */
export type SegmentNode = SegmentCondition | SegmentGroup;

/**
 * One leaf condition. Discriminated on `type` so evaluation can be written as
 * an exhaustive switch and the JSON stays validatable.
 *
 * - `status`      current contact status (subscribed / unsubscribed / ...)
 * - `property`    a key in `contacts.properties`
 * - `created_at`  contact creation date (`value` is an ISO timestamp, or a
 *                 number of days with `within_days`)
 * - `engagement`  has the contact opened or clicked (`event`) at least once,
 *                 or never, optionally limited to the last N days or to one
 *                 broadcast
 */
export type SegmentCondition =
  | {
      type: "status";
      operator: "eq" | "neq" | "in" | "not_in";
      value: ContactStatus | ContactStatus[];
    }
  | {
      type: "property";
      key: string;
      operator: SegmentPropertyOperator;
      /** Omitted only for `exists` / `not_exists`. */
      value?: string | number | boolean | Array<string | number>;
    }
  | {
      type: "created_at";
      operator: "before" | "after" | "within_days";
      /** ISO-8601 for before/after; number of days for within_days. */
      value: string | number;
    }
  | {
      type: "engagement";
      event: "opened" | "clicked";
      operator: "at_least_once" | "never";
      /** Restrict the lookback window, e.g. 30 for "clicked in the last 30 days". */
      within_days?: number;
      /** Restrict engagement to one broadcast (bc_... id). */
      broadcast_id?: string;
    };

export type SegmentRules = SegmentGroup;

/**
 * Example 1 — subscribers in Nigeria or Kenya who have never been mailed:
 * {
 *   "operator": "and",
 *   "conditions": [
 *     { "type": "status", "operator": "eq", "value": "subscribed" },
 *     { "type": "property", "key": "country", "operator": "in", "value": ["NG", "KE"] },
 *     { "type": "engagement", "event": "opened", "operator": "never" }
 *   ]
 * }
 *
 * Example 2 — customers who clicked the September launch broadcast in the
 * last 30 days, or who joined in the last week:
 * {
 *   "operator": "or",
 *   "conditions": [
 *     {
 *       "type": "engagement", "event": "clicked", "operator": "at_least_once",
 *       "within_days": 30, "broadcast_id": "bc_01h..."
 *     },
 *     {
 *       "operator": "and",
 *       "conditions": [
 *         { "type": "created_at", "operator": "within_days", "value": 7 },
 *         { "type": "status", "operator": "eq", "value": "subscribed" }
 *       ]
 *     }
 *   ]
 * }
 */

/**
 * A saved filter over one audience's contacts. Rules are data, not SQL: the
 * app evaluates them against `contacts` / `audience_contacts` / `link_clicks`,
 * so an invalid rule shape is a validation error, never an injection risk.
 */
export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(), // seg_...
    // CASCADE: segments belong to exactly one workspace.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // CASCADE: segments belong to exactly one project (the tenant key).
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // CASCADE: a segment filters one audience and is meaningless without it.
    audienceId: text("audience_id")
      .notNull()
      .references(() => audiences.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    rules: jsonb("rules").$type<SegmentRules>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segments_audience_idx").on(t.audienceId)]
);

export const segmentsRelations = relations(segments, ({ one }) => ({
  organization: one(organizations, {
    fields: [segments.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, { fields: [segments.projectId], references: [projects.id] }),
  audience: one(audiences, { fields: [segments.audienceId], references: [audiences.id] }),
}));

export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;
