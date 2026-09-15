import { pgTable, text, timestamp, varchar, index, jsonb } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";

export interface ProjectMetadata {
  environment?: "production" | "staging" | "development";
  useCases?: string[];
  monthlyVolume?: string;
}

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    metadata: jsonb("metadata").$type<ProjectMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_org_idx").on(t.organizationId),
    index("projects_org_slug_unique").on(t.organizationId, t.slug),
  ]
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
