import { describe, expect, it } from "vitest";
import { beaconBatchSchema, joinWaitlistSchema } from "./index";

describe("beaconBatchSchema", () => {
  const base = {
    sessionId: "abcdef1234567890",
    visitorId: "abcdef1234567890",
  };

  it("accepts a valid single event batch", () => {
    const parsed = beaconBatchSchema.safeParse({
      events: [{ type: "pageview", path: "/pricing", ...base }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts all four event types", () => {
    const types = ["pageview", "cta_click", "form_start", "form_complete"] as const;
    const parsed = beaconBatchSchema.safeParse({
      events: types.map((t) => ({ type: t, ...base })),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown event types", () => {
    const parsed = beaconBatchSchema.safeParse({
      events: [{ type: "mouse_move", ...base }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects oversized batches (cap 20)", () => {
    const events = Array.from({ length: 21 }, () => ({ type: "pageview", ...base }));
    const parsed = beaconBatchSchema.safeParse({ events });
    expect(parsed.success).toBe(false);
  });

  it("rejects missing anonymous ids", () => {
    const parsed = beaconBatchSchema.safeParse({ events: [{ type: "pageview" }] });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const parsed = beaconBatchSchema.safeParse({
      events: [{ type: "pageview", ...base }],
      sneaky: "field",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects client-supplied country (server-derived only)", () => {
    const parsed = beaconBatchSchema.safeParse({
      events: [{ type: "pageview", country: "NG", ...base }],
    });
    expect(parsed.success).toBe(false);
  });

  it("enforces length limits on paths and labels", () => {
    const long = "x".repeat(600);
    const parsed = beaconBatchSchema.safeParse({
      events: [{ type: "pageview", path: long, ...base }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("joinWaitlistSchema (attribution)", () => {
  it("accepts an optional source field", () => {
    const parsed = joinWaitlistSchema.safeParse({
      email: "A@B.com",
      first_name: "Sam",
      source: "linkedin",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("a@b.com");
      expect(parsed.data.source).toBe("linkedin");
    }
  });

  it("still accepts submissions without a source", () => {
    const parsed = joinWaitlistSchema.safeParse({ email: "a@b.com" });
    expect(parsed.success).toBe(true);
  });

  it("rejects absurd source values", () => {
    const parsed = joinWaitlistSchema.safeParse({
      email: "a@b.com",
      source: "x".repeat(200),
    });
    expect(parsed.success).toBe(false);
  });
});
