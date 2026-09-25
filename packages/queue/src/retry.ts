/**
 * Retry semantics, distinguish transient vs permanent failures.
 */

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const defaultRetryOptions: RetryOptions = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitter: true,
};

export function exponentialBackoff(attempt: number, baseMs = 1000, maxMs = 60_000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export function withJitter(delayMs: number): number {
  const jitter = Math.random() * 0.2 * delayMs; // ±20% jitter
  return Math.round(delayMs + (Math.random() > 0.5 ? jitter : -jitter));
}

export function getRetryDelay(attempt: number, opts: RetryOptions = defaultRetryOptions): number {
  const base = exponentialBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
  return opts.jitter ? withJitter(base) : base;
}

/**
 * Heuristic: transient errors are retryable (timeouts, 5xx, rate limits).
 * Permanent errors are not (validation, 4xx except 429).
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    // A provider adapter that already decided is authoritative: SES and Gmail
    // both stamp `transient` from the response they actually received. Guessing
    // past that verdict from the message text is how a 429 gets retried or
    // dropped depending on wording.
    const verdict = (error as { transient?: unknown }).transient;
    if (typeof verdict === "boolean") return verdict;
    const msg = error.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("etimedout"))
      return true;
    if (
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("503") ||
      msg.includes("502")
    )
      return true;
    // Provider throttling is transient. Matched loosely: SESv2 reports
    // `TooManyRequestsException`, legacy surfaces use `Throttling*`.
    const code = (error as { code?: string }).code ?? "";
    if (code.includes("Throttling") || code.includes("TooManyRequests")) return true;
  }
  // Providers stamp `statusCode`; some callers use `status`. Accept both —
  // reading only `status` silently classified provider 429/5xx as permanent.
  const { status, statusCode } = error as { status?: number; statusCode?: number };
  const effective = status ?? statusCode;
  if (effective && effective >= 500 && effective < 600) return true;
  if (effective === 429) return true;
  return false;
}

export function isPermanentError(error: unknown): boolean {
  if (isTransientError(error)) return false;
  const status = (error as { status?: number })?.status;
  if (status && status >= 400 && status < 500) return true;
  if (error instanceof Error && error.message.toLowerCase().includes("validation")) return true;
  return false;
}
