import { beforeEach, describe, expect, it } from "vitest";
import {
  probeWithTimeout,
  providerReachability,
  resetProviderReachabilityCache,
} from "./provider-reachability";

beforeEach(() => {
  resetProviderReachabilityCache();
});

describe("probeWithTimeout", () => {
  it("reports a provider that never answers as degraded, not as healthy", async () => {
    // The outage this exists for: a send leg that hangs for ~170s while every
    // health surface says "configured, therefore fine".
    const result = await probeWithTimeout(() => new Promise(() => {}), 30);
    expect(result.state).toBe("degraded");
    expect(result.detail).toContain("no response from the provider within 30ms");
  });

  it("aborts the losing request so a hung probe does not leak", async () => {
    let aborted = false;
    await probeWithTimeout(
      (signal) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      20
    );
    expect(aborted).toBe(true);
  });

  it("reports an answered probe as ok, with the time it took", async () => {
    const result = await probeWithTimeout(async () => ({ sandbox: false }), 500);
    expect(result.state).toBe("ok");
    expect(result.detail).toMatch(/provider answered in \d+ms/);
  });

  it("keeps the error class and drops the error message", async () => {
    // An SES failure names the address it refused. This string is served from
    // a public endpoint, so it must never carry provider text.
    class CredentialsProviderError extends Error {
      constructor() {
        super("Could not load credentials for ses:SendEmail to someone@customer.example");
      }
    }
    const result = await probeWithTimeout(async () => {
      throw new CredentialsProviderError();
    }, 500);
    expect(result.state).toBe("degraded");
    expect(result.detail).toBe("provider call failed (CredentialsProviderError)");
    expect(result.detail).not.toContain("someone@customer.example");
    expect(result.detail).not.toContain("Could not load credentials");
  });

  it("names an anonymous throw instead of leaking its text", async () => {
    const result = await probeWithTimeout(async () => {
      throw "arn:aws:ses:eu-west-1:123456789012:identity/intake.calder.click";
    }, 500);
    expect(result.detail).toBe("provider call failed (Error)");
    expect(result.detail).not.toContain("arn:aws");
  });
});

describe("providerReachability caching", () => {
  it("probes once, then serves the cached answer inside the window", async () => {
    let calls = 0;
    let clock = 1_000;
    const probe = async () => {
      calls++;
      return {};
    };
    const opts = { probe, cacheTtlMs: 60_000, now: () => clock };

    expect((await providerReachability(opts)).cached).toBe(false);
    clock += 30_000;
    const second = await providerReachability(opts);
    expect(second.cached).toBe(true);
    // A health monitor polls every few seconds; the provider must not see that.
    expect(calls).toBe(1);
  });

  it("probes again once the cache window has passed", async () => {
    let calls = 0;
    let clock = 1_000;
    const opts = {
      probe: async () => {
        calls++;
        return {};
      },
      cacheTtlMs: 60_000,
      now: () => clock,
    };
    await providerReachability(opts);
    clock += 61_000;
    expect((await providerReachability(opts)).cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("caches a failure too, so a dead provider is not hammered", async () => {
    let calls = 0;
    const opts = {
      probe: async () => {
        calls++;
        throw new Error("down");
      },
      cacheTtlMs: 60_000,
    };
    const first = await providerReachability(opts);
    const second = await providerReachability(opts);
    expect(first.result.state).toBe("degraded");
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });
});
