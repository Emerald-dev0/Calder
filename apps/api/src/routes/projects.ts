import { Hono } from "hono";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

const projects = new Hono<Env>();

projects.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { organizationId: string; projectId: string };
  const { getDb, projects: projectsTable } = await import("@calder/db");
  const { and, desc, eq, lt, or } = await import("drizzle-orm");
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const position = decodeApiCursor(c.req.query("cursor"));
  // API keys are project-bound. Keep the organization predicate as a
  // relationship check, but never let a project key enumerate sibling projects.
  const conditions = [
    eq(projectsTable.id, auth.projectId),
    eq(projectsTable.organizationId, auth.organizationId),
  ];
  if (position) {
    conditions.push(
      or(
        lt(projectsTable.createdAt, position.createdAt),
        and(eq(projectsTable.createdAt, position.createdAt), lt(projectsTable.id, position.id))
      )!
    );
  }
  const rows = await getDb()
    .select()
    .from(projectsTable)
    .where(and(...conditions))
    .orderBy(desc(projectsTable.createdAt), desc(projectsTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return c.json({
    data: page,
    pagination: {
      limit,
      next_cursor: hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null,
    },
  });
});

export default projects;
