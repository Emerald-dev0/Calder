import { describe, expect, it } from "vitest";
import { decodeApiCursor, encodeApiCursor } from "./pagination.js";

describe("API cursor pagination", () => {
  it("round-trips a date and id tiebreaker", () => {
    const cursor = encodeApiCursor(new Date("2026-01-02T03:04:05.000Z"), "email_123");
    expect(decodeApiCursor(cursor)).toEqual({
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      id: "email_123",
    });
  });

  it("rejects malformed cursors instead of treating them as page one", () => {
    expect(decodeApiCursor(undefined)).toBeNull();
    expect(() => decodeApiCursor("")).toThrow("Invalid pagination cursor");
    expect(() => decodeApiCursor("not-a-cursor")).toThrow("Invalid pagination cursor");
    const oversized = encodeApiCursor(new Date("2026-01-02T03:04:05.000Z"), "x".repeat(256));
    expect(() => decodeApiCursor(oversized)).toThrow("Invalid pagination cursor");
  });
});
