import { describe, it, expect } from "vitest";
import { requireScope, type AuthContext } from "./auth.js";

function ctx(scope: string): AuthContext {
  return {
    type: "api_key",
    apiKeyId: "key_1",
    projectId: "proj_1",
    organizationId: "org_1",
    env: "live",
    scope,
    keyPrefix: "calder...",
  };
}

describe("requireScope", () => {
  it("reads are allowed for every scope", () => {
    for (const s of ["full", "send", "read", ""]) {
      expect(() => requireScope(ctx(s), "read")).not.toThrow();
    }
  });

  it("sends need send or full", () => {
    expect(() => requireScope(ctx("send"), "send")).not.toThrow();
    expect(() => requireScope(ctx("full"), "send")).not.toThrow();
    expect(() => requireScope(ctx("read"), "send")).toThrow(/cannot send/);
  });

  it("management needs full, with fix guidance", () => {
    expect(() => requireScope(ctx("full"), "manage")).not.toThrow();
    expect(() => requireScope(ctx("send"), "manage")).toThrow(/full-scope/);
    expect(() => requireScope(ctx("read"), "manage")).toThrow(/full-scope/);
  });

  it("missing scope defaults to full (legacy keys)", () => {
    expect(() => requireScope(ctx(undefined as never), "manage")).not.toThrow();
  });
});
