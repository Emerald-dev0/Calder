import { describe, it, expect } from "vitest";
import {
  cumulative,
  denseDaily,
  fmtAgo,
  fmtMoney,
  fmtPct,
  pctChange,
  parseRange,
  rangeToDays,
  topDistribution,
} from "./format";
import { resolvePlatformRole } from "./roles";

describe("pctChange", () => {
  it("computes percentage change", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(90, 100)).toBeCloseTo(-10);
  });
  it("handles zero previous", () => {
    expect(pctChange(5, 0)).toBe(100);
    expect(pctChange(0, 0)).toBeNull();
  });
});

describe("denseDaily", () => {
  const today = new Date("2026-09-14T12:00:00Z");
  it("fills missing days with zeros over a fixed window", () => {
    const out = denseDaily([{ day: "2026-09-12", count: 3 }], 5, today);
    expect(out).toHaveLength(5);
    expect(out[0]?.day).toBe("2026-09-10");
    expect(out[4]?.day).toBe("2026-09-14");
    expect(out.find((d) => d.day === "2026-09-12")?.count).toBe(3);
    expect(out.find((d) => d.day === "2026-09-13")?.count).toBe(0);
  });
  it("spans from first activity to today when days is null", () => {
    const out = denseDaily([{ day: "2026-09-13", count: 2 }], null, today);
    expect(out.map((d) => d.day)).toEqual(["2026-09-13", "2026-09-14"]);
  });
  it("returns empty for no data when days is null", () => {
    expect(denseDaily([], null, today)).toEqual([]);
  });
});

describe("cumulative", () => {
  it("running-totals a dense series", () => {
    const out = cumulative([
      { day: "2026-09-01", count: 2 },
      { day: "2026-09-02", count: 3 },
      { day: "2026-09-03", count: 0 },
    ]);
    expect(out.map((p) => p.count)).toEqual([2, 5, 5]);
  });
});

describe("topDistribution", () => {
  it("caps tail into Other", () => {
    const out = topDistribution(
      [
        { label: "a", count: 5 },
        { label: "b", count: 4 },
        { label: "c", count: 3 },
      ],
      2
    );
    expect(out).toEqual([
      { label: "a", count: 5 },
      { label: "b", count: 4 },
      { label: "Other", count: 3 },
    ]);
  });
});

describe("ranges", () => {
  it("maps range keys to windows", () => {
    expect(rangeToDays("7d")).toBe(7);
    expect(rangeToDays("all")).toBeNull();
    expect(parseRange("bogus")).toBe("30d");
    expect(parseRange("90d")).toBe("90d");
  });
});

describe("formatters", () => {
  it("formats money in NGN", () => {
    expect(fmtMoney(2500000)).toBe("₦25,000");
    expect(fmtMoney(1600, "USD")).toBe("$16");
  });
  it("formats percentages defensively", () => {
    expect(fmtPct(98.74)).toBe("98.7%");
    expect(fmtPct(NaN)).toBe("—");
  });
  it("formats relative time", () => {
    const now = new Date("2026-09-14T12:00:00Z");
    expect(fmtAgo(new Date("2026-09-14T11:59:30Z"), now)).toBe("30s ago");
    expect(fmtAgo(new Date("2026-09-14T11:00:00Z"), now)).toBe("1h ago");
    expect(fmtAgo(new Date("2026-09-10T12:00:00Z"), now)).toBe("4d ago");
  });
});

describe("resolvePlatformRole", () => {
  it("non-founder db role applies for a non-founder email", () => {
    expect(resolvePlatformRole("a@x.com", "support", "boss@x.com")).toBe("support");
  });
  it("founder env bootstrap outranks a non-founder db role", () => {
    expect(resolvePlatformRole("a@x.com", "support", "a@x.com")).toBe("founder");
  });
  it("founder env bootstrap applies without db role", () => {
    expect(resolvePlatformRole("a@x.com", null, "A@x.com")).toBe("founder");
  });
  it("everyone else is a customer", () => {
    expect(resolvePlatformRole("b@x.com", null, "a@x.com")).toBeNull();
  });
});
