import { describe, it, expect } from "vitest";
import { nextRetryDelayMs, WEBHOOK_MAX_ATTEMPTS } from "./webhook-deliveries.js";

describe("webhook retry schedule (M3.1)", () => {
  it("grows monotonically through the published ladder", () => {
    const ladder = [1, 2, 3, 4, 5, 6].map((a) => nextRetryDelayMs(a)!);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeGreaterThan(ladder[i - 1]!);
    }
  });

  it("starts at 5s and caps at 6h", () => {
    expect(nextRetryDelayMs(1)).toBe(5_000);
    expect(nextRetryDelayMs(3)).toBe(120_000);
    expect(nextRetryDelayMs(6)).toBe(7_200_000);
    expect(nextRetryDelayMs(7)).toBe(21_600_000);
  });

  it("returns null when the schedule is exhausted", () => {
    expect(nextRetryDelayMs(8)).toBeNull();
    expect(nextRetryDelayMs(99)).toBeNull();
  });

  it("8 attempts is the contract", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });
});
