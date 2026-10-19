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
