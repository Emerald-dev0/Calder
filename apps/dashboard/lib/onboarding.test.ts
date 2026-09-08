import { describe, it, expect } from "vitest";
import { slugify, isValidSlug, USE_CASES } from "./onboarding";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });
  it("strips special chars and edge hyphens", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
  });
  it("caps at 100 chars", () => {
    expect(slugify("a".repeat(150)).length).toBeLessThanOrEqual(100);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase alphanumeric + hyphens", () => {
    expect(isValidSlug("acme-prod")).toBe(true);
  });
  it("rejects uppercase, spaces, empty", () => {
    expect(isValidSlug("Acme Prod")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });
});

describe("USE_CASES", () => {
  it("warns marketers off explicitly", () => {
    expect(USE_CASES.some((u) => u.toLowerCase().includes("transactional-only"))).toBe(true);
  });
});
