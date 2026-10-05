import type { MiddlewareHandler } from "hono";
import { apiRequestMetrics, logger } from "@calder/observability";

/**
 * Request logging + the sample window behind the API alert rules
 * (5xx rate, slowest request). Sampling every request in-process is
 * intentional: it is the only signal available without a metrics vendor, and
 * the window is bounded (see RequestMetrics).
 */
export const loggerMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const requestId = c.get("requestId");
  // c.res is a standard Response at runtime, but some build harnesses
  // resolve a Response type without .status and fail typechecking on direct
  // access. Read it defensively; runtime behavior is identical.
  const status = (c.res as unknown as { status: number }).status;
  apiRequestMetrics.record(status, duration);

  const auth = c.get("auth" as never) as
    { organizationId?: string; projectId?: string } | undefined;
  logger.info(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: duration,
      organizationId: auth?.organizationId,
      projectId: auth?.projectId,
    },
    `${c.req.method} ${c.req.path} -> ${status} (${duration}ms)`
  );
};
