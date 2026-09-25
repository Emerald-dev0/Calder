import { describe, it, expect } from "vitest";
import { lockoutDelayMs, LoginLockedError } from "./password.js";

/**
 * M6.1 lockout economy (ADR-040): below 3 failures no lock (typos forgiven),
 * then exponential 30s → 60s → … capped at 30m. The progression makes
 * credential grinding CPU-free for us and glacial for attackers.
 */
describe("progressive login lockout", () => {
  it("forgives the first two failures", () => {
    expect(lockoutDelayMs(1)).toBe(0);
    expect(lockoutDelayMs(2)).toBe(0);
  });

  it("locks from the third and doubles each failure", () => {
    expect(lockoutDelayMs(3)).toBe(30_000);
    expect(lockoutDelayMs(4)).toBe(60_000);
    expect(lockoutDelayMs(5)).toBe(120_000);
    expect(lockoutDelayMs(6)).toBe(240_000);
  });

  it("caps at 30 minutes and never overflows", () => {
    expect(lockoutDelayMs(9)).toBe(30 * 60_000);
    expect(lockoutDelayMs(50)).toBe(30 * 60_000);
  });

  it("carries the retry hint in the error", () => {
    const e = new LoginLockedError(42);
    expect(e.retryAfterSec).toBe(42);
    expect(e.message).toContain("42");
    expect(e.name).toBe("LoginLockedError");
  });
});
