import type { ErrorHandler } from "hono";
import { AppError, toPublicError } from "../errors/index.js";
import { logger } from "@calder/observability";

export const errorMiddleware: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;

  if (!isAppError) {
    logger.error({ err, requestId, path: c.req.path }, "Unhandled error");
    console.error(`[${requestId}] Unhandled error at ${c.req.path}:`, err);
  } else if (status >= 500) {
    logger.error({ err: err.message, code: err.code, requestId }, "Application error");
    console.error(`[${requestId}] Application error ${err.code}:`, err.message, err.stack);
  }

  const { body } = toPublicError(err, requestId);
  // Never expose stack in production
  return c.json(body, status as 400);
};
