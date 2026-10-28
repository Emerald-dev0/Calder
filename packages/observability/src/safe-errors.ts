/**
 * Stable operational reasons for persisted/customer-visible delivery state.
 * Provider exception messages are diagnostic data, not an API contract: they
 * may contain recipient addresses, host details, request ids, or credentials.
 * Keep the durable reason small and deliberately allowlisted.
 */
const SAFE_DELIVERY_CODES = new Set([
  "email_provider_not_configured",
  "gmail_cap",
  "gmail_credentials_missing",
  "gmail_revoked",
  "gmail_suspended",
  "gmail_validation",
  "gmail_velocity_limit",
  "InvalidRecipient",
  // Provider verdicts the error classifier already treats as permanent
  // (see PERMANENT_PROVIDER_CODES). They are stable AWS exception names that
  // carry no recipient, host or request detail, so keeping them is both safe
  // and useful: "Exhausted: MessageRejected" tells an operator why a message
  // will never be retried, where a bare "provider_error" tells them nothing.
  "MailFromDomainNotVerified",
  "MessageRejected",
  "AccountSuspendedException",
  "MockFailure",
  "organization_sending_unavailable",
  "provider_error",
  "sender_not_ready",
  "SesError",
  "Throttling",
  "TooManyRequestsException",
]);

export function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Return an allowlisted provider/operational code, never arbitrary text. */
export function safeDeliveryReason(error: unknown, fallback = "provider_error"): string {
  const code = errorCodeOf(error);
  return code && SAFE_DELIVERY_CODES.has(code) ? code : fallback;
}

/**
 * A constructor name is the *class* the error was thrown as, not the message.
 * It identifies the failing code path (`TypeError` in our own provider client,
 * `SESv2ServiceException` in the SDK) without carrying recipient addresses,
 * hostnames, request ids or credentials.
 *
 * A thrown plain object can claim any `constructor.name`, so the shape is
 * checked as well: a single identifier, 40 characters at most. Anything else
 * is dropped rather than persisted.
 *
 * KEEP THE SURFACE THIS SMALL. If a field ever needs to be added here, ask
 * whether it can contain data chosen by whoever sent the message; if it can,
 * it belongs in the log line, not in the row.
 */
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** Leg names come from our own chain ("default", "gmail", "mock"); bound anyway. */
const LEG_RE = /^[a-z][a-z0-9_-]{0,31}$/;

export function safeErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor;
  const name = ctor?.name;
  if (typeof name !== "string" || name === "Object") return null;
  return ERROR_NAME_RE.test(name) ? name : null;
}

export interface DeliveryFailureDetail {
  /** Allowlisted code — "provider_error" when nothing more precise survives. */
  code: string;
  /** The transport leg that failed last, if the caller knows it. */
  leg: string | null;
  /** Constructor name of the error, bounded to an identifier. */
  errorName: string | null;
}

/**
 * What we persist about a failed delivery.
 *
 * "provider_error" alone sends an operator to the wrong place: it cannot tell
 * a network timeout from an SDK rejecting the From header. The leg and the
 * error's class are ours and finite, so they are safe to keep; the message is
 * not, and never leaves the log.
 */
export function deliveryFailureDetail(error: unknown, leg?: string | null): DeliveryFailureDetail {
  const safeLeg = typeof leg === "string" && LEG_RE.test(leg) ? leg : null;
  return {
    code: safeDeliveryReason(error),
    leg: safeLeg,
    errorName: safeErrorName(error),
  };
}
