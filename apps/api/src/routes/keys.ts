import { Hono } from "hono";
import type { Env } from "../app.js";
import { createKeySchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { generateApiKey } from "@calder/auth";

const keys = new Hono<Env>();

function auth(c: { get: (k: string) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

/** Public shape: never the hash, never the secret (shown once at creation). */
function present(row: Record<string, unknown>) {
  return {
    id: row.id,
    object: "api_key",
    name: row.name,
    prefix: `${String(row.keyPrefix)}...`,
    env: row.env,
    scope: (row.scope as string | null) ?? "full",
    last_used_at: row.lastUsedAt ?? null,
    expires_at: row.expiresAt ?? null,
    revoked_at: row.revokedAt ?? null,
    created_at: row.createdAt,
  };
}

// GET /v1/keys, key management requires full scope
keys.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const { getDb, apiKeys } = await import("@calder/db");
  const { eq, desc } = await import("drizzle-orm");
  const db = getDb();
  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.projectId, a.projectId))
    .orderBy(desc(apiKeys.createdAt));
  return c.json({ data: rows.map((r) => present(r as Record<string, unknown>)) });
});

// POST /v1/keys, secret is shown exactly once here
keys.post("/", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid key", 400, parsed.error.flatten());

  const { getDb, apiKeys } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const db = getDb();
  const generated = generateApiKey(parsed.data.env);
  const [created] = await db
    .insert(apiKeys)
    .values({
      id: `key_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      projectId: a.projectId,
      name: parsed.data.name.trim().slice(0, 100),
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      env: parsed.data.env,
      scope: parsed.data.scope,
    })
    .returning();
  return c.json(
    {
      data: {
        ...present(created as Record<string, unknown>),
        secret: generated.secret,
        warning: "Copy the secret now. It is never shown again.",
      },
    },
    201
  );
});

// POST /v1/keys/:id/revoke
keys.post("/:id/revoke", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { getDb, apiKeys } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.projectId, a.projectId)))
    .returning();
  if (!updated) throw new AppError("not_found", "API key not found", 404);
  return c.json({ data: present(updated as Record<string, unknown>) });
});

export default keys;
