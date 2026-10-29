import { describe, expect, it } from "vitest";
import { activeControlHref } from "./navigation";
const items = [
  { href: "/control", exact: true },
  { href: "/control/customers" },
  { href: "/control/customers/organizations" },
];
describe("control navigation", () => {
  it("selects only the most specific visible route", () => {
    expect(activeControlHref("/control/customers/organizations/org_1", items)).toBe(
      "/control/customers/organizations"
    );
  });
  it("does not mark the command center active on every page", () => {
    expect(activeControlHref("/control/operations", items)).toBeUndefined();
    expect(activeControlHref("/control", items)).toBe("/control");
  });
  it("does not match a partial segment or mutate permission-filtered input", () => {
    expect(activeControlHref("/control/customers-other", items)).toBeUndefined();
    expect(items[0]?.href).toBe("/control");
  });
});
