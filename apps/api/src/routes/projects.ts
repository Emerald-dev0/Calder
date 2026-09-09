import { Hono } from "hono";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

const projects = new Hono<Env>();

projects.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { organizationId: string };
  try {
    const { getDb, projects: projectsTable } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.organizationId, auth.organizationId));
    return c.json({ data: rows });
  } catch {
    return c.json({ data: [] });
  }
});

export default projects;
