import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSesSuppression,
  clearSuppressionCache,
  sesSuppressionCheckConfigured,
  suppressionCacheSize,
} from "./ses-suppression.js";

/**
 * The delivery path's last question before handing mail to the provider.
 *
 * A wrong answer in either direction is expensive: a false "suppressed" drops
 * mail the customer paid for, and a false "clear" sends to an address SES has
 * already refused, which is exactly the behaviour that damages reputation. So
 * the interesting cases are the boundaries — cache lifetime, and what an
 * unreachable API means.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  clearSuppressionCache();
  process.env.AWS_ACCESS_KEY_ID = "test-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  clearSuppressionCache();
});

describe("sesSuppressionCheckConfigured", () => {
  it("is true only with both credentials present", () => {
    expect(
      sesSuppressionCheckConfigured({ AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" })
    ).toBe(true);
    expect(sesSuppressionCheckConfigured({ AWS_ACCESS_KEY_ID: "a" })).toBe(false);
    expect(sesSuppressionCheckConfigured({})).toBe(false);
  });

  it("answers 'unconfigured' instead of pretending the address is clear", async () => {
    process.env.AWS_ACCESS_KEY_ID = "";
    process.env.AWS_SECRET_ACCESS_KEY = "";
    const lookup = vi.fn();
    await expect(checkSesSuppression("a@b.test", { lookup })).resolves.toEqual({
      state: "unconfigured",
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("checkSesSuppression", () => {
  it("returns the suppression with its reason", async () => {
    const lookup = vi.fn(async () => ({
      suppressed: true,
      reason: "COMPLAINT" as const,
      lastUpdateTime: new Date("2026-02-03T00:00:00Z"),
    }));
    await expect(checkSesSuppression("a@b.test", { lookup })).resolves.toMatchObject({
      state: "suppressed",
      reason: "COMPLAINT",
    });
  });

  it("fails closed: an unreachable API is 'unknown', never 'clear'", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    await expect(checkSesSuppression("a@b.test", { lookup })).resolves.toEqual({
      state: "unknown",
      error: "socket hang up",
    });
  });

  it("does not cache an unknown answer, so the next attempt asks again", async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ suppressed: false });
    await checkSesSuppression("a@b.test", { lookup });
    await expect(checkSesSuppression("a@b.test", { lookup })).resolves.toEqual({ state: "clear" });
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("reuses a clear answer for a minute, then asks again", async () => {
    let now = 1_000_000;
    const lookup = vi.fn(async () => ({ suppressed: false }));
    const opts = { lookup, now: () => now };

    await checkSesSuppression("a@b.test", opts);
    now += 30_000;
    await checkSesSuppression("a@b.test", opts);
    expect(lookup).toHaveBeenCalledTimes(1);

    now += 31_000;
    await checkSesSuppression("a@b.test", opts);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("reuses a suppressed answer for five minutes only", async () => {
    let now = 0;
    const lookup = vi.fn(async () => ({ suppressed: true, reason: "BOUNCE" as const }));
    const opts = { lookup, now: () => now };

    await checkSesSuppression("a@b.test", opts);
    now += 4 * 60_000;
    await checkSesSuppression("a@b.test", opts);
    expect(lookup).toHaveBeenCalledTimes(1);

    now += 2 * 60_000;
    await checkSesSuppression("a@b.test", opts);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("normalises the address so casing cannot bypass a cached suppression", async () => {
    const lookup = vi.fn(async () => ({ suppressed: true, reason: "BOUNCE" as const }));
    await checkSesSuppression("Someone@Example.TEST", { lookup });
    await checkSesSuppression(" someone@example.test ", { lookup });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("someone@example.test");
  });

  it("stays bounded", async () => {
    const lookup = vi.fn(async () => ({ suppressed: false }));
    for (let i = 0; i < 5_100; i += 1) {
      await checkSesSuppression(`user${i}@b.test`, { lookup });
    }
    expect(suppressionCacheSize()).toBeLessThanOrEqual(5_000);
  });

  it("can be told to skip the cache (tests, tooling)", async () => {
    const lookup = vi.fn(async () => ({ suppressed: false }));
    await checkSesSuppression("a@b.test", { lookup, cache: false });
    await checkSesSuppression("a@b.test", { lookup, cache: false });
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
