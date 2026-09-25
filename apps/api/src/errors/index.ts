/**
 * Application error model, consistent public API error shape.
 * Never expose stack traces or provider secrets.
 */

export type ErrorCode =
  | "validation_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "not_found"
  | "conflict"
  | "provider_error"
  | "internal_error"
  | "domain_not_verified"
  | "suppressed"
  | "idempotency_conflict"
  | "sender_not_ready"
  | "plan_limit_reached";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
    /** What to do about it. Rendered in the public error body when present. */
    public fix?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError("validation_error", message, 400, details);
}

export function authenticationError(message = "Authentication required"): AppError {
  return new AppError("authentication_error", message, 401);
}

export function authorizationError(message = "Not authorized"): AppError {
  return new AppError("authorization_error", message, 403);
}

export function notFoundError(message = "Resource not found"): AppError {
  return new AppError("not_found", message, 404);
}

export function conflictError(message: string): AppError {
  return new AppError("conflict", message, 409);
}

export function rateLimitError(message = "Rate limit exceeded"): AppError {
  return new AppError("rate_limit_error", message, 429);
}

export function providerError(message: string): AppError {
  return new AppError("provider_error", message, 502);
}

export function internalError(message = "Internal server error"): AppError {
  return new AppError("internal_error", message, 500);
}

export interface PublicErrorBody {
  code: string;
  message: string;
  request_id: string;
  fix?: string;
}

export function toPublicError(
  err: unknown,
  requestId: string
): { status: number; body: { error: PublicErrorBody } } {
  if (err instanceof AppError) {
    const body: PublicErrorBody = {
      code: err.code,
      message: err.message,
      request_id: requestId,
    };
    if (err.fix) body.fix = err.fix;
    return { status: err.status, body: { error: body } };
  }
  // Zod validation errors
  if (err && typeof err === "object" && "issues" in err) {
    return {
      status: 400,
      body: {
        error: { code: "validation_error", message: "Validation failed", request_id: requestId },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: { code: "internal_error", message: "Internal server error", request_id: requestId },
    },
  };
}
