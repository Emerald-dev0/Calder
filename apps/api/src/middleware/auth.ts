import type { MiddlewareHandler } from "hono";
import { hashApiKey } from "@calder/auth";
import { authenticationError, authorizationError } from "../errors/index.js";

/**
 * API key authentication middleware.
 * Validates Authorization: Bearer <key>, hashes and looks up the credential,
 * then re-reads its project and organization on every request. There is no
 * authorization cache here: revocation, expiry, and organization suspension
 * are database trust-boundary checks, not UI or cache hints.
 */

// In-memory store for dev/test without DB. It is never used by the hosted DB
// path and its optional lifecycle fields are checked on every request too.
const devKeys = new Map<
  string,
  {
    apiKeyId: string;
    projectId: string;
    organizationId: string;
    env: "test" | "live";
    scope?: string;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  }
>();

export function registerDevKey(
  secret: string,
  ctx: {
    apiKeyId: string;
    projectId: string;
    organizationId: string;
    env: "test" | "live";
    scope?: string;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  }
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

  // Dev/test keys are intentionally explicit and never accepted by a hosted
  // production process. This fallback keeps unit/integration scaffolding
  // useful without weakening the persisted credential path.
  const devCtx = devKeys.get(hash);
  if (devCtx && process.env.NODE_ENV !== "production") {
    if (devCtx.revokedAt || (devCtx.expiresAt && devCtx.expiresAt <= new Date())) {
      throw authenticationError("Invalid or expired API key");
    }
    c.set("auth" as never, {
      type: "api_key",
      ...devCtx,
      scope: devCtx.scope ?? "full",
      keyPrefix: secret.slice(0, 20),
    });
    await next();
    return;
  }

  // Persisted key lookup is deliberately uncached: a revoke or organization
  // suspension is effective on the next request, including requests arriving
  // on another API instance.
  try {
    const { getDb, apiKeys, organizations, projects } = await import("@calder/db");
    const { and, eq, gt, isNull, or } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    const row = rows[0];
    const now = new Date();
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) {
      throw authenticationError("Invalid, revoked, or expired API key");
    }

    // Project → organization is part of the same query boundary. A key whose
    // project was deleted, moved, or whose organization is suspended cannot
    // authenticate through a stale project-only context.
    const [project] = await db
      .select({
        projectId: projects.id,
        organizationId: projects.organizationId,
        sendingStatus: organizations.sendingStatus,
      })
      .from(projects)
      .innerJoin(organizations, eq(projects.organizationId, organizations.id))
      .where(eq(projects.id, row.projectId))
      .limit(1);
    if (!project) throw authenticationError("Project not found for API key");
    if (project.sendingStatus !== "active") {
      throw authenticationError("Organization is unavailable");
    }

    // Touch usage only after all lifecycle checks pass. The conditional WHERE
    // prevents a concurrent revoke/expiry from being made to look active.
    const touched = await db
      .update(apiKeys)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiKeys.id, row.id),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))
        )
      )
      .returning({ id: apiKeys.id });
    if (touched.length === 0) {
      // A revoke or expiry won the race after the initial lookup. Do not let
      // the request continue with a stale authentication decision.
      throw authenticationError("Invalid, revoked, or expired API key");
    }

    c.set("auth" as never, {
      type: "api_key",
      apiKeyId: row.id,
      projectId: row.projectId,
      organizationId: project.organizationId,
      env: row.env as "test" | "live",
      scope: row.scope ?? "full",
      keyPrefix: row.keyPrefix,
    });
    await next();
    return;
  } catch (err) {
    if (err instanceof Error && err.name === "AppError") throw err;
    // If DB unavailable and no dev key matched, fail closed.
    throw authenticationError("Invalid API key");
  }
};

export type KeyScope = "full" | "send" | "read";

export interface AuthContext {
  type: string;
  apiKeyId: string;
  projectId: string;
  organizationId: string;
  env: "test" | "live";
  scope: string;
  keyPrefix: string;
}

/**
 * Scope gate: key management needs full; sends need send or full;
 * reads accept any valid key. Throws a 403 that names the fix.
 */
export function requireScope(auth: AuthContext, need: "manage" | "send" | "read"): void {
  const scope = auth.scope ?? "full";
  if (need === "read") return;
  if (need === "send" && (scope === "send" || scope === "full")) return;
  if (need === "manage" && scope === "full") return;
  throw authorizationError(
    need === "manage"
      ? "This API key cannot manage resources. Use a full-scope key."
      : "This API key cannot send. Use a send or full-scope key."
  );
}

/** Optional auth, does not throw if missing (for preview routes). */
export const optionalAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("authorization");
  if (!auth) {
    await next();
    return;
  }
  return authMiddleware(c, next);
};
