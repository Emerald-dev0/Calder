import { pgTable, text, varchar, timestamp, integer, index, pgEnum } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const controlIncidentStatus = pgEnum("control_incident_status", [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);
export const controlIncidentSeverity = pgEnum("control_incident_severity", [
  "sev1",
  "sev2",
  "sev3",
  "sev4",
]);
/** Private operator records. These tables are NOT a public status feed. */
export const controlIncidents = pgTable(
  "control_incidents",
  {
    id: text("id").primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: text("summary").notNull(),
    severity: controlIncidentSeverity("severity").notNull(),
    status: controlIncidentStatus("status").notNull().default("investigating"),
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("control_incidents_status_created_idx").on(t.status, t.createdAt)]
);
export const controlIncidentUpdates = pgTable(
  "control_incident_updates",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => controlIncidents.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    fromStatus: controlIncidentStatus("from_status").notNull(),
    toStatus: controlIncidentStatus("to_status").notNull(),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("control_incident_updates_incident_created_idx").on(t.incidentId, t.createdAt)]
);
