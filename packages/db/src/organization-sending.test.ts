import { describe, expect, it } from "vitest";
import { evaluateNewOrganizationSendLimit } from "./organization-sending.js";
import { INTERNAL_ORGANIZATION_ID } from "./usage.js";

const config = { newOrganizationSendLimit: 50, newOrganizationWindowHours: 24 };
const createdAt = new Date("2026-10-01T00:00:00.000Z");

describe("organization day-one sending cap", () => {
  it("allows sends up to the configured org-wide limit", () => {
    const result = evaluateNewOrganizationSendLimit({
      organizationCreatedAt: createdAt,
      now: new Date("2026-10-01T01:00:00.000Z"),
      acceptedInWindow: 49,
      incoming: 1,
      env: "live",
      config,
    });
    expect(result.allowed).toBe(true);
    expect(result.windowEndsAt).toEqual(new Date("2026-10-02T00:00:00.000Z"));
  });

  it("blocks the next accepted live send after the cap", () => {
    const result = evaluateNewOrganizationSendLimit({
      organizationCreatedAt: createdAt,
      now: new Date("2026-10-01T01:00:00.000Z"),
      acceptedInWindow: 50,
      incoming: 1,
      env: "live",
      config,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("new_organization_limit");
  });

  it("expires at the organization's configured age and exempts test/internal sends", () => {
    expect(
      evaluateNewOrganizationSendLimit({
        organizationCreatedAt: createdAt,
        now: new Date("2026-10-02T00:00:00.000Z"),
        acceptedInWindow: 500,
        env: "live",
        config,
      }).allowed
    ).toBe(true);
    expect(
      evaluateNewOrganizationSendLimit({
        organizationCreatedAt: createdAt,
        now: new Date("2026-10-01T01:00:00.000Z"),
        acceptedInWindow: 500,
        env: "test",
        config,
      }).allowed
    ).toBe(true);
    expect(
      evaluateNewOrganizationSendLimit({
        organizationId: INTERNAL_ORGANIZATION_ID,
        organizationCreatedAt: createdAt,
        now: new Date("2026-10-01T01:00:00.000Z"),
        acceptedInWindow: 500,
        env: "live",
        config,
      }).allowed
    ).toBe(true);
  });
});
