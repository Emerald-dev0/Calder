import { Hono } from "hono";
import type { Env } from "../app.js";
import { createSuppressionSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";

const suppressions = new Hono<Env>();

function auth(c: { get: (k: string) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

// GET /v1/suppressions, active suppression list for this project
suppressions.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const { getDb, suppressions: suppressionsTable } = await import("@calder/db");
  const { eq, desc } = await import("drizzle-orm");
  const db = getDb();
  const rows = await db
    .select({
      id: suppressionsTable.id,
      email: suppressionsTable.email,
      reason: suppressionsTable.reason,
      created_at: suppressionsTable.createdAt,
    })
    .from(suppressionsTable)
    .where(eq(suppressionsTable.projectId, a.projectId))
    .orderBy(desc(suppressionsTable.createdAt))
    .limit(200);
  return c.json({ data: rows });
});

// POST /v1/suppressions, manually suppress an address
suppressions.post("/", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createSuppressionSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid suppression", 400, parsed.error.flatten());

  const { getDb, suppressions: suppressionsTable } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const db = getDb();
  const email = parsed.data.email.trim().toLowerCase();
  const id = `sup_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db
    .insert(suppressionsTable)
    .values({ id, projectId: a.projectId, email, reason: parsed.data.reason })
    .onConflictDoNothing();
  return c.json({ data: { id, email, reason: parsed.data.reason } }, 201);
});

// DELETE /v1/suppressions/:id, lift a suppression (sends resume to this address)
suppressions.delete("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, suppressions: suppressionsTable } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const deleted = await db
    .delete(suppressionsTable)
    .where(and(eq(suppressionsTable.id, id), eq(suppressionsTable.projectId, a.projectId)))
    .returning({ id: suppressionsTable.id });
  if (deleted.length === 0) throw new AppError("not_found", "Suppression not found", 404);
  return c.json({ data: { id, deleted: true } });
});

export default suppressions;
