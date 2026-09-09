import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  isPlausibleEmail,
  hashMagicToken,
  magicLinkExpiry,
  isMagicTokenLive,
  MAGIC_LINK_TTL_MINUTES,
} from "./magic-link";

describe("magic-link helpers", () => {
  it("normalizes email for storage and lookup", () => {
    expect(normalizeEmail("  Founder@Calder.Click ")).toBe("founder@calder.click");
  });

  it("accepts plausible addresses, rejects junk", () => {
    expect(isPlausibleEmail("you@company.com")).toBe(true);
    expect(isPlausibleEmail("bogus")).toBe(false);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });

  it("hashes deterministically to hex, never the raw token", () => {
    const h1 = hashMagicToken("abc123");
    expect(h1).toBe(hashMagicToken("abc123"));
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toContain("abc123");
  });

  it("expires 15 minutes out", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const exp = magicLinkExpiry(from);
    expect(exp.getTime() - from.getTime()).toBe(MAGIC_LINK_TTL_MINUTES * 60 * 1000);
  });

  it("detects consumed or expired tokens", () => {
    const live = { expiresAt: new Date(Date.now() + 60_000), consumedAt: null };
    expect(isMagicTokenLive(live)).toBe(true);
    expect(isMagicTokenLive({ ...live, consumedAt: new Date() })).toBe(false);
    expect(isMagicTokenLive({ expiresAt: new Date(Date.now() - 1000), consumedAt: null })).toBe(
      false
    );
  });
});
