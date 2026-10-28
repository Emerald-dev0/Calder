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

  // ── The names the SDK actually throws ──────────────────────────
  // Everything above was collected by hand from the errors we happened to see,
  // which is why an outage could last hours behind the word "provider_error":
  // SESv2 reports a rejected identity as `MailFromDomainNotVerifiedException`,
  // while the list held `MailFromDomainNotVerified` — one word short, so the
  // single most likely cause of a failed send was guaranteed to be erased.
  // These come from the SDK's own exception models
  // (@aws-sdk/client-sesv2 models_0.d.ts), so they are a closed set of
  // identifiers, not text chosen by whoever sent the message.
  "MailFromDomainNotVerifiedException",
  "ConfigurationSetDoesNotExistException",
  "ConfigurationSetSendingPausedException",
  "AccountSendingPausedException",
  "SendingPausedException",
  "LimitExceededException",
  "BadRequestException",
  "NotFoundException",
  "InternalServiceErrorException",
  "ConflictException",
  "ValidationException",
  // Credential and authorization failures arrive from IAM/STS rather than SES,
  // and they were all invisible: a key without `ses:SendEmail` produced the
  // same word as an unverified domain.
  "AccessDeniedException",
  "AccessDenied",
  "NotAuthorized",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "ExpiredTokenException",
  "SignatureDoesNotMatch",
  "InvalidSignatureException",
  "CredentialsProviderError",
  // Google's transport reports in its own vocabulary; none of it was kept.
  "invalid_grant",
  "invalid_request",
  "unauthorized_client",
  "insufficientPermissions",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
]);

export function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  // The AWS SDK puts the API's error code in `name` (`AccessDeniedException`)
  // and only some transports copy it to `code`. Reading `code` alone dropped
  // every SES exception that reached us through the SDK's generic wrapper.
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
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
  // `name` is the exception's own code — AWS sets it from the API's error type
  // (`AccessDeniedException`), and it is what an operator needs. The
  // constructor name is the SDK's generic wrapper (`SESv2ServiceException`),
  // which said the same thing for every possible failure. Prefer the specific
  // one, and fall back to the class only when `name` is the generic "Error".
  const own = (error as { name?: unknown }).name;
  if (typeof own === "string" && own !== "Error" && ERROR_NAME_RE.test(own)) return own;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor;
  const name = ctor?.name;
  if (typeof name !== "string" || name === "Object") return null;
  return ERROR_NAME_RE.test(name) ? name : null;
}

/**
 * The HTTP status behind a provider error, when the transport recorded one.
 *
 * Bounded to 100–599 so a thrown object cannot smuggle a number that means
 * something else. This is the field that separates "your From address is not
 * verified" (400) from "your key is wrong" (403) from "wrong region" (404).
 */
export function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

export interface ProviderEvidence {
  /** Allowlisted code, or "provider_error" when nothing recognisable survived. */
  code: string;
  /** Exception name/code, bounded to an identifier. */
  errorName: string | null;
  /** HTTP status from the provider response, if any. */
  httpStatus: number | null;
}

/**
 * Everything an operator needs to identify a provider failure, and nothing an
 * attacker could have written.
 *
 * This exists because the failure path had none of it: the drain computed
 * `safeDeliveryReason(err)` and persisted the result, but never logged `err`.
 * So when every send failed for four hours, the only trace anywhere was the
 * word "provider_error" — the exception had already been thrown away by the
 * time anyone could look. Log this object; never log the message.
 */
export function providerEvidence(error: unknown): ProviderEvidence {
  return {
    code: safeDeliveryReason(error),
    errorName: safeErrorName(error),
    httpStatus: httpStatusOf(error),
  };
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
