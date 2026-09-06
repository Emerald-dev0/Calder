import { describe, it, expect } from "vitest";
import { InMemoryRateLimiter, rateLimitPresets, buildRateLimitKey } from "./index.js";

describe("rate limiting", () => {
  it("allows requests within limit", async () => {
    const limiter = new InMemoryRateLimiter();
    const result = await limiter.check("test", { windowMs: 60000, max: 2 });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it("blocks when limit exceeded", async () => {
    const limiter = new InMemoryRateLimiter();
    await limiter.check("test", { windowMs: 60000, max: 1 });
    const result = await limiter.check("test", { windowMs: 60000, max: 1 });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("buildRateLimitKey includes dimensions", () => {
    const key = buildRateLimitKey({ ip: "1.2.3.4", projectId: "proj_123", endpoint: "send" });
    expect(key).toContain("ip:1.2.3.4");
    expect(key).toContain("proj:proj_123");
    expect(key).toContain("ep:send");
  });

  it("presets are defined", () => {
    expect(rateLimitPresets.sending.max).toBeGreaterThan(0);
  });
});
