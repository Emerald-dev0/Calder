import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  InMemoryRateLimiter,
  rateLimitPresets,
  setRateLimiter,
  type RateLimiter,
  type RateLimitResult,
} from "@calder/rate-limit";
import { rateLimitMiddleware } from "./rate-limit.js";
import { errorMiddleware } from "./error.js";

/**
 * The 429 contract.
 *
 * A rate limit a client cannot react to is a wall: without `Retry-After` the
 * only sane reaction to a 429 is a blind backoff loop, which is exactly the
 * traffic the limit exists to stop. These cases pin the headers, the error
 * code, and the fact that an allowed request says how much budget is left.
 */
function appFor(preset: keyof typeof rateLimitPresets) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, {
      apiKeyId: "key_1",
      projectId: "proj_1",
      organizationId: "org_1",
    });
    await next();
  });
  // The real app turns AppErrors into responses; a bare Hono app does not.
  app.onError(errorMiddleware);
  app.get("/thing", rateLimitMiddleware(preset), (c) => c.json({ ok: true }));
  return app;
}

const savedLimiter = new InMemoryRateLimiter();

beforeEach(() => setRateLimiter(savedLimiter));
afterEach(() => setRateLimiter(savedLimiter));

describe("rate limit headers", () => {
  it("tells an allowed request what budget it has left", async () => {
    savedLimiter.clear();
    const res = await appFor("read").request("/thing");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe(String(rateLimitPresets.read.max));
    expect(Number(res.headers.get("x-ratelimit-remaining"))).toBe(rateLimitPresets.read.max - 1);
    expect(res.headers.get("x-ratelimit-reset")).toMatch(/^\d+$/);
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("carries Retry-After in whole seconds on a refusal, alongside the error code", async () => {
    const denying: RateLimiter = {
      async check(): Promise<RateLimitResult> {
        return {
          allowed: false,
          limit: 600,
          remaining: 0,
          resetAt: new Date(Date.now() + 30_000),
          retryAfterMs: 31_400,
        };
      },
      async reset() {},
    };
    setRateLimiter(denying);

    const res = await appFor("read").request("/thing");
    expect(res.status).toBe(429);
    // Rounded up: a client that waits exactly 31s must be inside the window.
    expect(res.headers.get("retry-after")).toBe("32");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limit_error");
  });

  it("falls back to a minute when the limiter does not say how long", async () => {
    setRateLimiter({
      async check(): Promise<RateLimitResult> {
        return { allowed: false, limit: 1, remaining: 0, resetAt: new Date() };
      },
      async reset() {},
    });
    const res = await appFor("read").request("/thing");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("keys the bucket by preset as well as tenant, so a read limit cannot spend send budget", async () => {
    const keys: string[] = [];
    setRateLimiter({
      async check(key: string, opts): Promise<RateLimitResult> {
        keys.push(key);
        return { allowed: true, limit: opts.max, remaining: opts.max - 1, resetAt: new Date() };
      },
      async reset() {},
    });
    await appFor("read").request("/thing");
    await appFor("sending").request("/thing");
    expect(keys[0]).toContain("rl:read");
    expect(keys[1]).toContain("rl:sending");
    // Tenant dimensions are in the key: one key's traffic cannot throttle
    // another project's, and the IP is a final fallback.
    expect(keys[0]).toContain("org:org_1");
    expect(keys[0]).toContain("proj:proj_1");
    expect(keys[0]).toContain("key:key_1");
  });
});

describe("preset shape", () => {
  it("metering reads is generous enough that only scripts notice", () => {
    // Ten a second, sustained. An honest client polling for a delivery status
    // is nowhere near this; a scraper is far above it.
    expect(rateLimitPresets.read.max).toBeGreaterThanOrEqual(300);
    expect(rateLimitPresets.read.windowMs).toBe(60_000);
  });

  it("bounds credential operations per hour", () => {
    expect(rateLimitPresets.keyAdmin.windowMs).toBe(3_600_000);
    expect(rateLimitPresets.keyAdmin.max).toBeLessThanOrEqual(60);
  });
});
