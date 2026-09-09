import { describe, it, expect } from "vitest";
import { pickDefaultTransport, type TransportRecord } from "./transport";

function row(overrides: Partial<TransportRecord>): TransportRecord {
  return {
    id: "tr_1",
    projectId: "proj_1",
    type: "gmail",
    status: "active",
    label: "dev@gmail.com",
    encryptedCredentials: null,
    dailyCap: 400,
    isDefault: false,
    ...overrides,
  };
}

describe("pickDefaultTransport", () => {
  it("returns null when nothing is configured", () => {
    expect(pickDefaultTransport([])).toBeNull();
  });

  it("picks the active default", () => {
    const gmail = row({ id: "tr_g", type: "gmail", isDefault: true });
    const ses = row({ id: "tr_s", type: "ses", isDefault: false });
    expect(pickDefaultTransport([ses, gmail])?.id).toBe("tr_g");
  });

  it("fails closed on suspended/revoked defaults", () => {
    const bad = row({ id: "tr_x", isDefault: true, status: "suspended" });
    expect(pickDefaultTransport([bad])).toBeNull();
  });

  it("ignores non-default actives (caller falls back to global provider)", () => {
    const plain = row({ id: "tr_p", isDefault: false });
    expect(pickDefaultTransport([plain])).toBeNull();
  });
});
