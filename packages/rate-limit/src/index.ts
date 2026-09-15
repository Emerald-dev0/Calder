/**
 * Centralized rate limiting, supports IP, user, org, project, apiKey, endpoint dimensions.
 * Abstraction over Redis-compatible store; InMemory fallback for dev/test.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterMs?: number;
}

export interface RateLimiter {
  check(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

/**
 * In-memory sliding window counter. NOT for production multi-instance use, replace with Redis.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private store = new Map<string, { count: number; windowStart: number }>();

  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now - entry.windowStart >= opts.windowMs) {
      this.store.set(key, { count: 1, windowStart: now });
      return {
        allowed: true,
        limit: opts.max,
        remaining: opts.max - 1,
        resetAt: new Date(now + opts.windowMs),
      };
    }

    entry.count += 1;
    const allowed = entry.count <= opts.max;
    const remaining = Math.max(0, opts.max - entry.count);
    const resetAt = new Date(entry.windowStart + opts.windowMs);
    const retryAfterMs = allowed ? undefined : resetAt.getTime() - now;

    return { allowed, limit: opts.max, remaining, resetAt, retryAfterMs };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** For tests: clear all */
  clear(): void {
    this.store.clear();
  }
}

// Predefined limit categories per ARCHITECTURE.md §10
export const rateLimitPresets = {
  sending: { windowMs: 60_000, max: 100 }, // 100 sends / min per key
  verification: { windowMs: 60_000, max: 10 },
  auth: { windowMs: 60_000, max: 20 },
  webhook: { windowMs: 60_000, max: 60 },
  otp: { windowMs: 60_000, max: 5 },
  waitlist: { windowMs: 60_000, max: 5 }, // unauthenticated public signup
  dashboard: { windowMs: 60_000, max: 120 },
  // First-party analytics beacon: batched events (≤20/batch), real browsers
  // send a handful of batches per minute; abusive floods get shed cheaply.
  beacon: { windowMs: 60_000, max: 120 },
} as const;

export function buildRateLimitKey(dimension: {
  ip?: string;
  apiKeyId?: string;
  projectId?: string;
  organizationId?: string;
  endpoint?: string;
}): string {
  const parts: string[] = ["rl"];
  if (dimension.endpoint) parts.push(`ep:${dimension.endpoint}`);
  if (dimension.organizationId) parts.push(`org:${dimension.organizationId}`);
  if (dimension.projectId) parts.push(`proj:${dimension.projectId}`);
  if (dimension.apiKeyId) parts.push(`key:${dimension.apiKeyId}`);
  if (dimension.ip) parts.push(`ip:${dimension.ip}`);
  return parts.join(":");
}

// Singleton for app use; can be replaced with RedisRateLimiter
let defaultLimiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!defaultLimiter) defaultLimiter = new InMemoryRateLimiter();
  return defaultLimiter;
}

export function setRateLimiter(limiter: RateLimiter): void {
  defaultLimiter = limiter;
}
