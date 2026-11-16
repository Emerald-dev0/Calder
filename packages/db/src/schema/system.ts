import { pgTable, text, timestamp, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";
import { projects } from "./projects.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    action: varchar("action", { length: 100 }).notNull(),
    // e.g., organization.created, api_key.created
    targetType: varchar("target_type", { length: 100 }),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.organizationId),
    index("audit_logs_action_idx").on(t.action),
  ]
);

export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    // stable alias for send-by-alias. Unique per project, lowercase/hyphens.
    alias: varchar("alias", { length: 100 }),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("templates_project_idx").on(t.projectId),
    index("templates_project_alias_unique").on(t.projectId, t.alias),
  ]
);

export interface TemplateVariableDeclaration {
  name: string;
  required: boolean;
}

export const templateVersions = pgTable(
  "template_versions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 20 }).notNull(),
    subject: varchar("subject", { length: 998 }),
    html: text("html"),
    text: text("text"),
    // Stage 4.1: a version is a draft until published, and sends only ever use
    // a published one. Existing rows were live, so the column defaults to
    // `published` and the migration backfills `published_at` from `created_at`
    // — nobody's working template stops sending because we added a lifecycle.
    status: varchar("status", { length: 16 }).notNull().default("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Declared variables are part of the contract: publishing refuses a
    // placeholder that is not declared, so a caller can never be asked for
    // something the template did not announce.
    variables: jsonb("variables").$type<TemplateVariableDeclaration[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("template_versions_template_idx").on(t.templateId),
    index("template_versions_template_status_idx").on(t.templateId, t.status),
  ]
);

export type AuditLog = typeof auditLogs.$inferSelect;
