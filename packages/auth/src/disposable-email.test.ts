import { describe, expect, it } from "vitest";
import { resetConfig } from "@calder/config";
import {
  assertNotDisposableEmail,
  DisposableEmailError,
  isDisposableEmail,
} from "./disposable-email.js";

describe("disposable email signup gate", () => {
  it("blocks built-in temporary mailbox domains and their subdomains", () => {
    expect(isDisposableEmail("person@mailinator.com")).toBe(true);
    expect(isDisposableEmail("person@sub.yopmail.com")).toBe(true);
    expect(isDisposableEmail("person@MAILDROP.CC")).toBe(true);
  });

  it("does not block ordinary or malformed addresses", () => {
    expect(isDisposableEmail("person@example.com")).toBe(false);
    expect(isDisposableEmail("not-an-address")).toBe(false);
  });

  it("supports exact and subdomain matches in a deployment-supplied set", () => {
    const domains = new Set(["temp.example"]);
    expect(isDisposableEmail("person@temp.example", domains)).toBe(true);
    expect(isDisposableEmail("person@mx.temp.example", domains)).toBe(true);
    expect(isDisposableEmail("person@example", domains)).toBe(false);
  });

  it("appends configured deployment domains to the built-in list", () => {
    const previous = process.env.DISPOSABLE_EMAIL_DOMAINS;
    process.env.DISPOSABLE_EMAIL_DOMAINS = "throwaway.example, mx.temporary.example";
    resetConfig();
    try {
      expect(isDisposableEmail("person@throwaway.example")).toBe(true);
      expect(isDisposableEmail("person@mx.throwaway.example")).toBe(true);
      expect(isDisposableEmail("person@temporary.example")).toBe(false);
      expect(isDisposableEmail("person@mx.temporary.example")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.DISPOSABLE_EMAIL_DOMAINS;
      else process.env.DISPOSABLE_EMAIL_DOMAINS = previous;
      resetConfig();
    }
  });

  it("throws a generic user-safe error without exposing the matched domain", () => {
    expect(() => assertNotDisposableEmail("person@mailinator.com")).toThrow(DisposableEmailError);
    try {
      assertNotDisposableEmail("person@mailinator.com");
    } catch (err) {
      expect((err as Error).message).toBe(
        "This email address isn't supported. Use a different email address."
      );
      expect((err as Error).message).not.toContain("mailinator");
    }
  });
});
