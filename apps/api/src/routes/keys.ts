import { Hono } from "hono";
import type { Env } from "../app.js";
import { createKeySchema, rotateKeySchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError, validationError } from "../errors/index.js";
import { generateApiKey } from "@calder/auth";
import { randomUUID } from "node:crypto";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

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
  const { and, desc, eq, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor");
  const conditions = [eq(apiKeys.projectId, a.projectId)];
  const position = decodeApiCursor(cursor);
  if (position) {
    conditions.push(
      or(
        lt(apiKeys.createdAt, position.createdAt),
        and(eq(apiKeys.createdAt, position.createdAt), lt(apiKeys.id, position.id))
      )!
    );
  }
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(...conditions))
    .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  return c.json({
    data: page.map((r) => present(r as Record<string, unknown>)),
    pagination: { limit, next_cursor: nextCursor },
  });
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

  const { auditLogs, getDb, insertApiKeyForActiveOrganization, OrganizationNotActiveError } =
    await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const db = getDb();
  const generated = generateApiKey(parsed.data.env);
  let created;
  try {
    [created] = await insertApiKeyForActiveOrganization(db, a.projectId, {
      id: `key_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      projectId: a.projectId,
      name: parsed.data.name.trim().slice(0, 100),
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      env: parsed.data.env,
      scope: parsed.data.scope,
      ...(parsed.data.expires_at !== undefined
        ? { expiresAt: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null }
        : {}),
    });
  } catch (err) {
    if (err instanceof OrganizationNotActiveError) {
      throw new AppError(
        "organization_sending_unavailable",
        "Sending is currently unavailable for this organization.",
        403
      );
    }
    throw err;
  }
  if (!created) throw new AppError("internal_error", "Could not create API key.", 500);
  await db
    .insert(auditLogs)
    .values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: a.organizationId,
      projectId: a.projectId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: created.id,
      metadata: {
        env: created.env,
        scope: created.scope,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
    })
    .catch(() => {});
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

// POST /v1/keys/:id/rotate — atomically creates a replacement and revokes
// the old key. The new secret is shown exactly once; the old key is never
// accepted after this transaction commits.
keys.post("/:id/rotate", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const parsed = rotateKeySchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("validation_error", "Invalid key rotation", 400, parsed.error.flatten());
  }

  const {
    auditLogs,
    getDb,
    apiKeys,
    rotateApiKeyForActiveOrganization,
    OrganizationNotActiveError,
  } = await import("@calder/db");
  const { randomUUID } = await import("node:crypto");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [old] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.projectId, a.projectId)))
    .limit(1);
  if (!old || old.revokedAt) throw new AppError("not_found", "API key not found", 404);

  const generated = generateApiKey(old.env as "test" | "live");
  try {
    const result = await rotateApiKeyForActiveOrganization(db, a.projectId, id, {
      id: `key_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      projectId: a.projectId,
      name: parsed.data.name?.trim().slice(0, 100) || `${old.name} (rotated)`.slice(0, 100),
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      env: old.env,
      scope: parsed.data.scope ?? old.scope,
      expiresAt:
        parsed.data.expires_at !== undefined
          ? parsed.data.expires_at
            ? new Date(parsed.data.expires_at)
            : null
          : old.expiresAt,
    });
    if (!result.created) throw new AppError("internal_error", "Could not rotate API key.", 500);
    await db
      .insert(auditLogs)
      .values({
        id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        organizationId: a.organizationId,
        projectId: a.projectId,
        action: "api_key.rotated",
        targetType: "api_key",
        targetId: result.created.id,
        metadata: { previousKeyId: id, env: result.created.env, scope: result.created.scope },
      })
      .catch(() => {});
    return c.json(
      {
        data: {
          ...present(result.created as Record<string, unknown>),
          secret: generated.secret,
          rotated_from: id,
          warning: "Copy the secret now. It is never shown again.",
        },
      },
      201
    );
  } catch (err) {
    if (err instanceof OrganizationNotActiveError) {
      throw new AppError(
        "organization_sending_unavailable",
        "Sending is currently unavailable for this organization.",
        403
      );
    }
    if (err instanceof Error && /API key/.test(err.message)) {
      throw new AppError("conflict", "API key changed during rotation; retry.", 409);
    }
    throw err;
  }
});

// POST /v1/keys/:id/revoke
keys.post("/:id/revoke", authMiddleware, async (c) => {
  const a = auth(c);
  requireScope(a, "manage");
  const id = c.req.param("id");
  const { auditLogs, getDb, apiKeys } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.projectId, a.projectId)))
    .returning();
  if (!updated) throw new AppError("not_found", "API key not found", 404);
  await db
    .insert(auditLogs)
    .values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      organizationId: a.organizationId,
      projectId: a.projectId,
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: updated.id,
    })
    .catch(() => {});
  return c.json({ data: present(updated as Record<string, unknown>) });
});

export default keys;
