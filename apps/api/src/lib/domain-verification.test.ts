import { describe, it, expect } from "vitest";
import {
  checkOwnership,
  expectedTxtHost,
  expectedTxtValue,
  newVerificationToken,
  TXT_VALUE_PREFIX,
} from "@calder/db";

/**
 * M4.1 unit tests: pure challenge mechanics + verdict mapping.
 * The full state machine (rate limiter, cross-tenant, TTL expiry) is covered
 * by domain-verification.integration.test.ts against a real Postgres with an
 * injected oracle — no live DNS needed in either suite.
 */

describe("ownership challenge", () => {
  it("tokens have ≥192-bit entropy and the expected TXT host/value", () => {
    const t = newVerificationToken();
    expect(t.startsWith("cvt_")).toBe(true);
    expect(t).toMatch(/^cvt_[0-9a-f]{48}$/);
    expect(newVerificationToken()).not.toBe(t);
    expect(expectedTxtHost("example.com")).toBe("_calder.example.com");
    expect(expectedTxtValue(t)).toBe(`${TXT_VALUE_PREFIX}${t}`);
  });

  it("verified only on exact value match (substring tricks do not count)", async () => {
    const token = newVerificationToken();
    const value = expectedTxtValue(token);
    expect(await checkOwnership(async () => [value], "_calder.example.com", value)).toEqual({
      kind: "verified",
    });
    // Multi-chunk TXT joined correctly by the oracle; exact match still required.
    // A longer record containing the value as substring must NOT verify.
    const near = await checkOwnership(
      async () => [`${value} extra-spf-stuff`],
      "_calder.example.com",
      value
    );
    expect(near.kind).toBe("mismatch");
  });

  it("mismatch returns bounded diagnostics and never echoes >5 records", async () => {
    const value = expectedTxtValue(newVerificationToken());
    const verdict = await checkOwnership(
      async () => ["a", "b", "c", "d", "e", "f", "g"],
      "_calder.example.com",
      value
    );
    expect(verdict.kind).toBe("mismatch");
    if (verdict.kind === "mismatch") expect(verdict.found).toHaveLength(5);
  });

  it("oracle failure maps to dns_error (propagation tolerated, retryable)", async () => {
    const verdict = await checkOwnership(
      async () => {
        throw new Error("DNS lookup timed out");
      },
      "_calder.example.com",
      "anything"
    );
    expect(verdict.kind).toBe("dns_error");
    if (verdict.kind === "dns_error") expect(verdict.message).toContain("timed out");
  });
});
