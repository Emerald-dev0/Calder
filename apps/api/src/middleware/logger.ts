import type { MiddlewareHandler } from "hono";
import { logger } from "@calder/observability";

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const requestId = c.get("requestId");
  // c.res is a standard Response at runtime, but some build harnesses
  // resolve a Response type without .status and fail typechecking on direct
  // access. Read it defensively; runtime behavior is identical.
  const status = (c.res as unknown as { status: number }).status;
  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: duration,
    },
    `${c.req.method} ${c.req.path} -> ${status} (${duration}ms)`
  );
};
