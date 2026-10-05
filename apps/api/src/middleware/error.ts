import type { ErrorHandler } from "hono";
import { AppError, toPublicError } from "../errors/index.js";
import { captureError } from "@calder/observability";

/**
 * Central error handler.
 *
 * Every failure goes through `captureError`, which classifies it (client error
 * vs provider rejection vs infrastructure vs unexpected), logs it with the
 * request context, and ships only genuinely unexpected failures to error
 * tracking. That classification is what keeps an alert channel readable: a 401
 * from a misconfigured client is not an incident.
 */
export const errorMiddleware: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;
  const auth = c.get("auth" as never) as
    { organizationId?: string; projectId?: string } | undefined;

  captureError(err, {
    service: "api",
    requestId,
    route: `${c.req.method} ${c.req.path}`,
    organizationId: auth?.organizationId,
    projectId: auth?.projectId,
  });

  const { body } = toPublicError(err, requestId);
  // Never expose stack traces, internal messages or provider secrets.
  return c.json(body, status as 400);
};
