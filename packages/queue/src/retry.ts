/**
 * Retry semantics — distinguish transient vs permanent failures.
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
    // Provider throttling is transient
    if ((error as { code?: string }).code === "Throttling") return true;
  }
  const status = (error as { status?: number })?.status;
  if (status && status >= 500 && status < 600) return true;
  if (status === 429) return true;
  return false;
}

export function isPermanentError(error: unknown): boolean {
  if (isTransientError(error)) return false;
  const status = (error as { status?: number })?.status;
  if (status && status >= 400 && status < 500) return true;
  if (error instanceof Error && error.message.toLowerCase().includes("validation")) return true;
  return false;
}
