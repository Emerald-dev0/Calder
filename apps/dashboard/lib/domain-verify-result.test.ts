import { describe, expect, it } from "vitest";
import { mapVerifyOutcome } from "./domain-verify-result";

describe("mapVerifyOutcome", () => {
  it("returns verified with a confirmation message", () => {
    expect(
      mapVerifyOutcome({ kind: "verified", domain: "acme.com", verifiedAt: new Date() })
    ).toEqual({ verified: true, detail: "TXT record matched. Domain verified." });
  });

  it("returns rate_limited gracefully with a stop-polling flag instead of throwing", () => {
    expect(mapVerifyOutcome({ kind: "rate_limited", retryAfterSec: 1500 })).toEqual({
      verified: false,
      rateLimited: true,
      detail: "Too many attempts — try again in 25m.",
    });
  });

  it("returns cross_tenant gracefully instead of throwing", () => {
    const result = mapVerifyOutcome({ kind: "cross_tenant", domain: "acme.com" });
    expect(result.verified).toBe(false);
    expect(result.detail).toMatch(/already verified on another project/);
  });

  it("distinguishes missing TXT records from token mismatch", () => {
    const expected = { host: "_calder.acme.com", value: "calder-verification=cvt_x" };
    expect(
      mapVerifyOutcome({ kind: "mismatch", status: "failed", expected, found: [], attemptsLeft: 9 })
    ).toEqual({
      verified: false,
      detail: "No TXT records yet at _calder.acme.com — propagation can take minutes to hours.",
    });
    expect(
      mapVerifyOutcome({
        kind: "mismatch",
        status: "failed",
        expected,
        found: ["v=spf1 include:amazonses.com ~all"],
        attemptsLeft: 8,
      }).detail
    ).toMatch(/none match the challenge exactly/);
  });

  it("returns expired and dns_error gracefully", () => {
    expect(mapVerifyOutcome({ kind: "expired", retryAfterSec: null }).verified).toBe(false);
    expect(
      mapVerifyOutcome({
        kind: "dns_error",
        status: "failed",
        message: "ENOTFOUND",
        attemptsLeft: 9,
      }).detail
    ).toMatch(/DNS lookup failed/);
  });

  it("still throws for genuinely exceptional states", () => {
    expect(() => mapVerifyOutcome({ kind: "not_found" })).toThrow("Domain not found.");
  });
});
