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

/**
 * Redis-backed fixed-window limiter (M6.1, ADR-041).
 *
 * Why: Vercel serverless means N warm instances, and an in-memory limit of
 * "20/min" silently becomes 20×N/min — the production pathfinder documented
 * as M2. Fixed-window INCR + PEXPIRE inside one MULTI keeps exactness per
 * window and needs one round-trip per check. Sliding-window niceness is
 * deliberately NOT ported: fixed-window burst-at-boundary is acceptable for
 * auth endpoints and keeps the Lua surface zero (atomicity via MULTI).
 */
type ExecResult = Array<[unknown, unknown]> | null;
interface RedisMultiLike {
  incr: (k: string) => RedisMultiLike;
  pExpire: (k: string, ms: number) => RedisMultiLike;
  exec: () => Promise<ExecResult>;
}
interface RedisClientLike {
  multi: () => RedisMultiLike;
}

export class RedisRateLimiter implements RateLimiter {
  private client: RedisClientLike;
  private fallback: RateLimiter;
  private readonly failClosed: boolean;
  /** Rolling window for the degraded-mode counter (see `degradedSince`). */
  private lastFallbackLogAt = 0;
  private fallbacks = 0;

  constructor(redis: RedisClientLike, options: { failClosed?: boolean } = {}) {
    this.client = redis;
    this.fallback = new InMemoryRateLimiter();
    this.failClosed = options.failClosed ?? false;
  }

  /**
   * How many checks have fallen back to per-instance memory, and when the
   * most recent fallback happened. Exposed so the API can report "limits are
   * currently approximate" instead of degrading invisibly (ADR-041 chose
   * availability over exactness — that choice stays, but it must be legible).
   */
  degradedState(): { fallbacks: number; lastFallbackAt: string | null; failClosed: boolean } {
    return {
      fallbacks: this.fallbacks,
      failClosed: this.failClosed,
      lastFallbackAt: this.lastFallbackLogAt
        ? new Date(this.lastFallbackLogAt).toISOString()
        : null,
    };
  }

  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const fullKey = `rate:${opts.keyPrefix ?? "limit"}:${key}`;
    try {
      const windowMs = opts.windowMs;
      const results = await this.client.multi().incr(fullKey).exec();
      const first = results?.[0]?.[1];
      const count = typeof first === "number" ? first : 1;
      // Set the TTL only for the first increment. Extending it on every
      // request turns a fixed window into an accidental permanent lockout for
      // an account under sustained traffic.
      if (count === 1) await this.client.multi().pExpire(fullKey, windowMs).exec();
      const allowed = count <= opts.max;
      const remaining = Math.max(0, opts.max - count);
      const resetAt = new Date(Date.now() + windowMs);
      return {
        allowed,
        limit: opts.max,
        remaining,
        resetAt,
        retryAfterMs: allowed ? undefined : windowMs,
      };
    } catch {
      // Hosted authentication controls fail closed when Redis is unavailable.
      // A request that cannot be globally counted must not receive a local
      // per-instance allowance. Development/test retains the explicit memory
      // fallback for local work.
      this.fallbacks += 1;
      const now = Date.now();
      if (now - this.lastFallbackLogAt > 60_000) {
        this.lastFallbackLogAt = now;
        console.warn(
          this.failClosed
            ? "[rate-limit] Redis unavailable: rejecting rate-limited requests until it recovers."
            : "[rate-limit] Redis unavailable: using per-instance limits in development/test."
        );
      }
      if (this.failClosed) {
        return {
          allowed: false,
          limit: opts.max,
          remaining: 0,
          resetAt: new Date(now + opts.windowMs),
          retryAfterMs: opts.windowMs,
        };
      }
      return this.fallback.check(key, opts);
    }
  }

  async reset(key: string): Promise<void> {
    await this.fallback.reset(key);
  }
}

/**
 * Boot-time wiring: hosted deployments require Redis for authentication-rate
 * limits. A missing URL is a configuration error, and a runtime Redis outage
 * rejects checks instead of silently downgrading to per-instance memory.
 */
export async function configureRateLimiterFromEnv(): Promise<"redis" | "memory"> {
  const url = process.env.REDIS_URL?.trim();
  const hosted =
    process.env.NODE_ENV === "production" ||
    process.env.CALDER_ENV === "staging" ||
    process.env.CALDER_ENV === "production";
  if (url) {
    const { default: IORedis } = await import("ioredis");
    // Structural cast: the limiter only needs a MULTI-able surface.
    setRateLimiter(
      new RedisRateLimiter(
        new IORedis(url, { maxRetriesPerRequest: 2 }) as unknown as RedisClientLike,
        { failClosed: hosted }
      )
    );
    return "redis";
  }
  if (hosted) {
    throw new Error("REDIS_URL is required for hosted authentication rate limits.");
  }
  return "memory";
}
