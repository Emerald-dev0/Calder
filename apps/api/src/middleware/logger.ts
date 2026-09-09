import type { MiddlewareHandler } from "hono";
import { logger } from "@calder/observability";

export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
 const start = Date.now();
 await next();
 const duration = Date.now() - start;
 const requestId = c.get("requestId");
 logger.info(
 {
 requestId,
 method: c.req.method,
 path: c.req.path,
 status: c.res.status,
 durationMs: duration,
 },
 `${c.req.method} ${c.req.path} -> ${c.res.status} (${duration}ms)`
 );
};
