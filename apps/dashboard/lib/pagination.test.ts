import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./pagination";

describe("dashboard cursor pagination", () => {
  it("round-trips the date and deterministic id tiebreaker", () => {
    const cursor = encodeCursor({ createdAt: new Date("2026-01-02T03:04:05.000Z"), id: "row_123" });
    expect(decodeCursor(cursor)).toEqual({
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      id: "row_123",
    });
  });

  it("rejects malformed, ambiguous, and oversized cursors", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor("not-a-cursor")).toThrow("Invalid pagination cursor");
    expect(() => decodeCursor(["a", "b"])).toThrow("Invalid pagination cursor");
    const oversized = encodeCursor({
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      id: "x".repeat(256),
    });
    expect(() => decodeCursor(oversized)).toThrow("Invalid pagination cursor");
  });
});
