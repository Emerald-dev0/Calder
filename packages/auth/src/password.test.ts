import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
} from "./password";
import { generateOtpCode, hashCode, EMAIL_CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS } from "./email-code";

describe("password hashing & verification (scrypt)", () => {
  it("hashes password into salt:key format", async () => {
    const hash = await hashPassword("super-secret-pass-123");
    expect(hash).toContain(":");
    const [salt, key] = hash.split(":");
    expect(salt).toHaveLength(32); // 16 bytes hex
    expect(key).toHaveLength(128); // 64 bytes hex
  });

  it("produces distinct salts and hashes for the same password", async () => {
    const h1 = await hashPassword("same-password-456");
    const h2 = await hashPassword("same-password-456");
    expect(h1).not.toBe(h2);
    expect(h1.split(":")[0]).not.toBe(h2.split(":")[0]);
  });

  it("verifies correct password", async () => {
    const pass = "calder-infrastructure-2026";
    const hash = await hashPassword(pass);
    const ok = await verifyPassword(pass, hash);
    expect(ok).toBe(true);
  });

  it("rejects incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    const ok = await verifyPassword("wrong-horse-battery", hash);
    expect(ok).toBe(false);
  });

  it("safely handles null, undefined, or malformed hashes without throwing", async () => {
    expect(await verifyPassword("password123", null)).toBe(false);
    expect(await verifyPassword("password123", undefined)).toBe(false);
    expect(await verifyPassword("password123", "")).toBe(false);
    expect(await verifyPassword("password123", "malformed-no-colon")).toBe(false);
  });

  it("validates password length bounds", () => {
    expect(validatePasswordStrength("1234567").valid).toBe(false);
    expect(validatePasswordStrength("12345678").valid).toBe(true);
    expect(validatePasswordStrength("a".repeat(MIN_PASSWORD_LEN)).valid).toBe(true);
    expect(validatePasswordStrength("a".repeat(MAX_PASSWORD_LEN)).valid).toBe(true);
    expect(validatePasswordStrength("a".repeat(MAX_PASSWORD_LEN + 1)).valid).toBe(false);
  });
});

describe("email OTP code helpers", () => {
  it("generates a 6-digit numeric string", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThan(1000000);
    }
  });

  it("hashes OTP codes deterministically via sha256", () => {
    const c1 = hashCode("123456");
    const c2 = hashCode("123456");
    const c3 = hashCode("654321");
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[a-f0-9]{64}$/);
    expect(c1).not.toBe(c3);
  });

  it("exposes expected constants", () => {
    expect(EMAIL_CODE_TTL_MINUTES).toBe(10);
    expect(MAX_CODE_ATTEMPTS).toBe(5);
  });
});
