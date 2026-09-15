import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getConfig } from "@calder/config";
import { AppError } from "../errors/index.js";

/**
 * Admin gate for /v1/admin/*. Single shared secret (env ADMIN_API_KEY),
 * constant-time compared. Interim until SSO-backed admin roles exist.
 * Unset key = routes disabled (503, honest) rather than open.
 */
export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const configured = getConfig().ADMIN_API_KEY;
  if (!configured) {
    throw new AppError("internal_error", "Admin operations are disabled on this deployment.", 503);
  }
  const auth = c.req.header("authorization");
  const presented = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length) {
    throw new AppError("authentication_error", "Admin authentication required.", 401);
  }
  let ok = false;
  try {
    ok = timingSafeEqual(a, b);
  } catch {
    ok = false;
  }
  if (!ok) throw new AppError("authentication_error", "Admin authentication required.", 401);
  await next();
};
