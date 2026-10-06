/**
 * Auth error sanitizer for API routes.
 *
 * Incident: a missing database column (`users.failed_login_attempts`) made
 * Postgres errors reach the signup form verbatim ("column ... does not
 * exist"). Raw driver errors leak schema details (tables, columns,
 * constraints) and read as broken product. Rule: only messages from the
 * explicit allowlist below — the exact strings `@calder/auth` throws
 * deliberately for users — ever reach the client. Everything else
 * (PostgresError, TypeErrors, unknown failures) maps to a generic fallback
 * while the route records only a sanitized failure classification server-side;
 * sensitive provider/driver text must not enter browser responses or logs.
 *
 * When adding a new user-facing auth error in @calder/auth, add its exact
 * string here. Never add anything containing schema, SQL, or driver detail.
 */
const USER_SAFE_ERRORS = new Set([
  "Provide a valid email address.",
  "Provide a valid email.",
  "Enter a valid 6-digit code.",
  "This code is invalid or has expired. Please request a new one.",
  "Too many failed attempts. Please request a new code.",
  "Invalid code. Please check and try again.",
  "Invalid email or password.",
  "This link is invalid or expired.",
  "This email address isn't supported. Use a different email address.",
  "Current password is incorrect.",
  "New password must be different from the current password.",
  "Add a password or another sign-in method before disconnecting this account.",
  "Account not found.",
  "OAuth account not found.",
]);

export function safeAuthError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  if (USER_SAFE_ERRORS.has(err.message)) return err.message;
  // Password-strength reasons are generated from constants
  // ("Password must be at least 8 characters."), never from user input.
  if (err.message.startsWith("Password must ")) return err.message;
  return fallback;
}
