import { describe, expect, it } from "vitest";
import { DnsVerificationProvider } from "./domain-verification.js";

describe("DNS domain verification", () => {
  it("accepts the exact challenge returned by TXT", async () => {
    const provider = new DnsVerificationProvider(async (hostname) => {
      expect(hostname).toBe("_calder.example.com");
      return [["calder_verify_abc1234567890123"]];
    });
    await expect(provider.verify("Example.COM.", "calder_verify_abc1234567890123")).resolves.toMatchObject({ verified: true });
  });

  it("does not treat a missing record as verified", async () => {
    const provider = new DnsVerificationProvider(async () => [["another-value"]]);
    await expect(provider.verify("example.com", "calder_verify_abc1234567890123")).resolves.toMatchObject({ verified: false });
  });

  it("returns a diagnosable result on resolver failure", async () => {
    const provider = new DnsVerificationProvider(async () => { throw new Error("timeout"); });
    await expect(provider.verify("example.com", "calder_verify_abc1234567890123")).resolves.toMatchObject({ verified: false, details: "DNS lookup failed: timeout" });
  });
});
