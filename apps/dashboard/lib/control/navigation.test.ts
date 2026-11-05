import { describe, expect, it } from "vitest";
import { activeControlHref } from "./navigation";

describe("control navigation", () => {
  const items = [
    { href: "/control", exact: true },
    { href: "/control/customers" },
    { href: "/control/customers/organizations" },
  ];
  it("selects the most specific parent for a detail page", () => {
    expect(activeControlHref("/control/customers/organizations/org_123", items)).toBe(
      "/control/customers/organizations"
    );
  });
  it("does not match partial path segments or an exact-only parent", () => {
    expect(activeControlHref("/control/customers-extra", items)).toBeNull();
    expect(activeControlHref("/control", items)).toBe("/control");
  });
});
