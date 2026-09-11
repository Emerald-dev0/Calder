import { describe, it, expect } from "vitest";
import { parseSenderRef, isSenderUsable } from "./sender-service.js";

describe("parseSenderRef", () => {
  it("recognizes sender IDs", () => {
    expect(parseSenderRef("sender_abc123")).toEqual({ kind: "id", id: "sender_abc123" });
    expect(parseSenderRef("  sender_x-1  ")).toEqual({ kind: "id", id: "sender_x-1" });
  });

  it("treats everything else as a bare address", () => {
    expect(parseSenderRef("hello@calder.click")).toEqual({
      kind: "email",
      email: "hello@calder.click",
    });
    expect(parseSenderRef("sender_")).toEqual({ kind: "email", email: "sender_" });
    expect(parseSenderRef("not-an-id!")).toEqual({ kind: "email", email: "not-an-id!" });
  });
});

describe("isSenderUsable", () => {
  it("allows verified and connected only", () => {
    expect(isSenderUsable("verified")).toBe(true);
    expect(isSenderUsable("connected")).toBe(true);
    expect(isSenderUsable("pending")).toBe(false);
    expect(isSenderUsable("disabled")).toBe(false);
    expect(isSenderUsable("failed")).toBe(false);
  });
});
