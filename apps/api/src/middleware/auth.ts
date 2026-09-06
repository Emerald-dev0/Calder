import type { MiddlewareHandler } from "hono";
import { hashApiKey } from "@avenor/auth";
import { authenticationError } from "../errors/index.js";

/**
 * API key authentication middleware.
 * Validates Authorization: Bearer <key> header, hashes and looks up.
 * For scaffold, supports in-memory fallback and DB lookup.
 */

// In-memory store for dev/test without DB (fallback)
const devKeys = new Map<
  string,
  { apiKeyId: string; projectId: string; organizationId: string; env: "test" | "live" }
>();

export function registerDevKey(
  secret: string,
  ctx: { apiKeyId: string; projectId: string; organizationId: string; env: "test" | "live" }
): void {
  const hash = hashApiKey(secret);
  devKeys.set(hash, ctx);
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    throw authenticationError("Missing or invalid Authorization header");
  }
  const secret = auth.slice(7).trim();
  if (!secret) throw authenticationError("Missing API key");

  const hash = hashApiKey(secret);

  // Try dev in-memory first
  const devCtx = devKeys.get(hash);
  if (devCtx) {
    c.set("auth" as never, { type: "api_key", ...devCtx, keyPrefix: secret.slice(0, 20) });
    await next();
    return;
  }

  // Try DB lookup — lazy import to avoid circular deps
  try {
    const { getDb } = await import("@avenor/db");
    const { apiKeys } = await import("@avenor/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    const row = rows[0];
    if (!row || row.revokedAt) {
      throw authenticationError("Invalid or revoked API key");
    }
    // Need project -> org lookup for tenant scope
    const { projects } = await import("@avenor/db");
    const projRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .limit(1);
    const project = projRows[0];
    if (!project) throw authenticationError("Project not found for API key");

    c.set("auth" as never, {
      type: "api_key",
      apiKeyId: row.id,
      projectId: row.projectId,
      organizationId: project.organizationId,
      env: row.env as "test" | "live",
      keyPrefix: row.keyPrefix,
    });
    await next();
    return;
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") throw err;
    // If DB unavailable and no dev key matched, fail closed
    throw authenticationError("Invalid API key");
  }
};

/**
 * Optional auth — does not throw if missing (for preview routes).
 */
export const optionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth) {
    await next();
    return;
  }
  return authMiddleware(c, next);
};
