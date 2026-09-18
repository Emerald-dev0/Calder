import { describe, expect, it } from "vitest";
import { resolvePostLoginTarget, sanitizeNext } from "./post-login";

const FOUNDERS = "oluwadare458@gmail.com";

describe("sanitizeNext", () => {
  it("accepts same-origin absolute paths", () => {
    expect(sanitizeNext("/control/growth")).toBe("/control/growth");
    expect(sanitizeNext("/")).toBe("/");
    expect(sanitizeNext("/emails")).toBe("/emails");
  });

  it("rejects open-redirect shapes", () => {
    expect(sanitizeNext("https://evil.example")).toBeNull();
    expect(sanitizeNext("//evil.example/control")).toBeNull();
    expect(sanitizeNext("/\\evil")).toBeNull();
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
  });
});

describe("resolvePostLoginTarget", () => {
  it("sends the founder to /control, not /control/growth", () => {
    expect(
      resolvePostLoginTarget({
        email: "oluwadare458@gmail.com",
        dbRole: null,
        founderEmails: FOUNDERS,
      })
    ).toBe("/control");
  });

  it("treats founder email case-insensitively", () => {
    expect(
      resolvePostLoginTarget({
        email: "Oluwadare458@Gmail.Com",
        dbRole: null,
        founderEmails: FOUNDERS,
      })
    ).toBe("/control");
  });

  it("honors an explicit DB founder role without the env bootstrap", () => {
    expect(
      resolvePostLoginTarget({
        email: "someone@example.com",
        dbRole: "founder",
        founderEmails: undefined,
      })
    ).toBe("/control");
  });

  it("sends a non-founder platform role (e.g. support) to /control", () => {
    // Any platform role grants Control Plane access; section scoping happens
    // per-page via requireSection, not at login.
    expect(
      resolvePostLoginTarget({
        email: "staff@example.com",
        dbRole: "support",
        founderEmails: "other@example.com",
      })
    ).toBe("/control");
  });

  it("sends regular customers to the normal dashboard", () => {
    expect(
      resolvePostLoginTarget({
        email: "customer@example.com",
        dbRole: null,
        founderEmails: FOUNDERS,
      })
    ).toBe("/");
  });

  it("honors a safe non-control next for anyone", () => {
    expect(
      resolvePostLoginTarget({
        email: "customer@example.com",
        dbRole: null,
        founderEmails: FOUNDERS,
        next: "/emails",
      })
    ).toBe("/emails");
  });

  it("honors a /control deep link for the founder", () => {
    expect(
      resolvePostLoginTarget({
        email: "oluwadare458@gmail.com",
        dbRole: null,
        founderEmails: FOUNDERS,
        next: "/control/growth",
      })
    ).toBe("/control/growth");
  });

  it("refuses a /control deep link for non-founders (no login bounce loop)", () => {
    expect(
      resolvePostLoginTarget({
        email: "customer@example.com",
        dbRole: null,
        founderEmails: FOUNDERS,
        next: "/control",
      })
    ).toBe("/");
  });

  it("ignores an unsafe next and falls back to the role default", () => {
    expect(
      resolvePostLoginTarget({
        email: "oluwadare458@gmail.com",
        dbRole: null,
        founderEmails: FOUNDERS,
        next: "https://evil.example",
      })
    ).toBe("/control");
    expect(
      resolvePostLoginTarget({
        email: "customer@example.com",
        dbRole: null,
        founderEmails: FOUNDERS,
        next: "https://evil.example",
      })
    ).toBe("/");
  });
});
