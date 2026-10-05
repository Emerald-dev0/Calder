/**
 * Error classification.
 *
 * Every error that reaches a log or an error tracker is sorted into exactly
 * one class, because "error" alone is not actionable: a 400 from a client and
 * a Redis outage both end up in the same stream otherwise, and an alerting
 * channel that fires on both is one nobody reads.
 *
 * `reportable` answers "should this create an error-tracking event a human may
 * inspect?", not "is this bad?" — expected client errors and retried
 * infrastructure failures are not incidents.
 */

export type ErrorClass =
  /** Caller's fault and already explained to them: bad payload, missing auth. */
  | "client_error"
  /** Schema/field validation failure. */
  | "validation_error"
  /** Provider said no (permanent rejection, invalid recipient, quota). */
  | "provider_rejection"
  /** Timeouts, connection resets, 5xx, throttling — the queue retries these. */
  | "retryable_infrastructure"
  /** Deliberate application state: org paused, sender not ready. */
  | "application_failure"
  /** Nothing matched: a bug, or a dependency failing in a shape we did not expect. */
  | "unexpected_exception"
  /** Signature failures, revoked-key reuse, lockouts — worth a human eye. */
  | "security_event";

export type ErrorSeverity = "info" | "warning" | "error" | "fatal";

export interface ErrorClassification {
  class: ErrorClass;
  severity: ErrorSeverity;
  /** Should this be sent to error tracking? */
  reportable: boolean;
  /** Short, stable reason used in logs and alert payloads. */
  reason: string;
}

/**
 * Customer-explainable verdicts: they describe the request or account state,
 * are returned to the caller with a fix, and are not incidents. Reporting them
 * would bury real failures under expected traffic (a public API sees constant
 * 401s from misconfigured clients).
 */
const EXPLAINED_CLIENT_CODES = new Set([
  "validation_error",
  "authentication_error",
  "authorization_error",
  "not_found",
  "conflict",
  "rate_limit_error",
  "idempotency_conflict",
  "plan_limit_reached",
  "domain_not_verified",
  "suppressed",
  "sender_not_ready",
]);

/** Signature failures, revoked-key reuse and lockouts: real security signals. */
const SECURITY_CODES = new Set([
  "invalid_signature",
  "signature_mismatch",
  "webhook_signature_invalid",
  "key_revoked",
  "lockout",
  "abuse_blocked",
]);

/** Provider verdicts that are permanent (no retry will help). */
const PERMANENT_PROVIDER_CODES = new Set([
  "InvalidRecipient",
  "MessageRejected",
  "MailFromDomainNotVerified",
  "AccountSuspendedException",
  "gmail_cap",
]);

/**
 * Rare, deliberate states that stop sending for an account. They are not bugs,
 * but somebody should know they happened (Phase 1 audits them as well).
 */
const ATTENTION_CODES = new Set([
  "gmail_suspended",
  "organization_suspended",
  "organization_sending_unavailable",
]);

function codeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const raw =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  const num = typeof raw === "string" ? Number(raw) : raw;
  return typeof num === "number" && Number.isFinite(num) ? num : undefined;
}

function transientOf(err: unknown): boolean | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as { transient?: unknown }).transient;
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Zod/validation shapes arrive as `{ issues: [...] }`, app errors as
 * `{ code, status }`. Both are covered without importing either layer.
 */
export function classifyError(err: unknown): ErrorClassification {
  const code = codeOf(err);
  const status = statusOf(err);
  const transient = transientOf(err);

  if (typeof err === "object" && err !== null && "issues" in err && !code) {
    return {
      class: "validation_error",
      severity: "info",
      reportable: false,
      reason: "schema_validation",
    };
  }

  if (code && EXPLAINED_CLIENT_CODES.has(code)) {
    return {
      class: code === "validation_error" ? "validation_error" : "client_error",
      severity: "info",
      reportable: false,
      reason: `client:${code}`,
    };
  }

  if (code && SECURITY_CODES.has(code)) {
    return {
      class: "security_event",
      severity: "warning",
      reportable: true,
      reason: `security:${code}`,
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      class: "retryable_infrastructure",
      severity: "warning",
      reportable: false,
      reason: `http_${status}`,
    };
  }
  if (transient === true) {
    return {
      class: "retryable_infrastructure",
      severity: "warning",
      reportable: false,
      reason: `transient:${code ?? "unknown"}`,
    };
  }
  if (code && PERMANENT_PROVIDER_CODES.has(code)) {
    return {
      class: "provider_rejection",
      severity: "warning",
      reportable: true,
      reason: `provider:${code}`,
    };
  }
  if (code && ATTENTION_CODES.has(code)) {
    return {
      class: "application_failure",
      severity: "warning",
      reportable: true,
      reason: `attention:${code}`,
    };
  }
  if (status === 429) {
    return { class: "client_error", severity: "info", reportable: false, reason: "rate_limited" };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { class: "client_error", severity: "info", reportable: false, reason: `http_${status}` };
  }
  if (transient === false) {
    return {
      class: "application_failure",
      severity: "warning",
      reportable: true,
      reason: `non_retryable:${code ?? "unknown"}`,
    };
  }

  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("redis") ||
    message.includes("connection") ||
    message.includes("socket hang up")
  ) {
    return {
      class: "retryable_infrastructure",
      severity: "warning",
      reportable: false,
      reason: "infrastructure_unreachable",
    };
  }

  return {
    class: "unexpected_exception",
    severity: "error",
    reportable: true,
    reason: "unexpected",
  };
}

/** Human-readable one-liner for logs: class + reason, never a raw payload. */
export function describeClassification(classification: ErrorClassification): string {
  return `${classification.class}/${classification.reason}`;
}
