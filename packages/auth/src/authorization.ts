import type { AuthContext } from "./types.js";

/**
 * Centralized authorization helpers.
 * Every data access must be scoped through these, not just route middleware.
 */

export class AuthorizationError extends Error {
  status = 403;
  code = "authorization_error" as const;
  constructor(message = "Not authorized to access this resource") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  status = 401;
  code = "authentication_error" as const;
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Assert auth context has access to the given project.
 * Throws AuthorizationError if not.
 */
export function requireProjectAccess(ctx: AuthContext, projectId: string): void {
  if (ctx.type === "api_key") {
    if (ctx.projectId !== projectId) {
      throw new AuthorizationError("API key does not have access to this project");
    }
    return;
  }
  // Session-based: organization check is higher-level; project membership would be checked via DB
  // For scaffold, session users are assumed to have passed org membership middleware
  if (!ctx.organizationId) {
    throw new AuthorizationError("No organization context");
  }
}

export function requireOrgAccess(ctx: AuthContext, organizationId: string): void {
  const ctxOrg = ctx.type === "api_key" ? ctx.organizationId : ctx.organizationId;
  if (ctxOrg !== organizationId) {
    throw new AuthorizationError("Not a member of this organization");
  }
}

/**
 * Generic tenant scope assertion, ensures resource owner matches context.
 * Call at data-access layer before returning any tenant data.
 */
export function assertTenantScope(
  resource: { projectId?: string; organizationId?: string },
  ctx: AuthContext
): void {
  if (resource.projectId && ctx.type === "api_key" && resource.projectId !== ctx.projectId) {
    throw new AuthorizationError("Resource does not belong to this project");
  }
  if (resource.organizationId) {
    const ctxOrg = ctx.type === "api_key" ? ctx.organizationId : ctx.organizationId;
    if (ctxOrg && resource.organizationId !== ctxOrg) {
      throw new AuthorizationError("Resource does not belong to this organization");
    }
  }
}
