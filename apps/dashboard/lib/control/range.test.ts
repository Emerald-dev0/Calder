import { describe, expect, it } from "vitest";
import {
  compareWindow,
  denseDailyFromWindow,
  fmtDeltaPct,
  fmtDeltaPp,
  parseRange,
  pctChange,
  ppChange,
} from "./range";

// Fixed "now" for deterministic tests: 2026-09-15T12:00:00Z
const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("parseRange", () => {
  it("defaults to 30d on missing/invalid input", () => {
    const w = parseRange(undefined, undefined, undefined, NOW);
    expect(w.key).toBe("30d");
    expect(w.days).toBe(30);
    const bad = parseRange("nonsense", undefined, undefined, NOW);
    expect(bad.key).toBe("30d");
  });

  it("today spans exactly today and compares to yesterday", () => {
    const w = parseRange("today", undefined, undefined, NOW);
    expect(w.start?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(w.days).toBe(1);
    expect(w.compareStart?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(w.compareLabel).toContain("previous day");
  });

  it("yesterday is the day before today", () => {
    const w = parseRange("yesterday", undefined, undefined, NOW);
    expect(w.start?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("7d includes today plus six prior days", () => {
    const w = parseRange("7d", undefined, undefined, NOW);
    expect(w.start?.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-09-16T00:00:00.000Z");
    expect(w.days).toBe(7);
  });

  it("this month starts on the 1st and compares with last month", () => {
    const w = parseRange("this_month", undefined, undefined, NOW);
    expect(w.start?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.days).toBe(30);
    expect(w.compareStart?.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("last month is the full previous calendar month", () => {
    const w = parseRange("last_month", undefined, undefined, NOW);
    expect(w.start?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.days).toBe(31);
  });

  it("all time is unbounded with no comparison", () => {
    const w = parseRange("all", undefined, undefined, NOW);
    expect(w.start).toBeNull();
    expect(w.end).toBeNull();
    expect(w.compareStart).toBeNull();
    expect(w.compareStart).toBeNull();
  });

  it("custom windows honor from/to and fall back on malformed input", () => {
    const w = parseRange("custom", "2026-09-01", "2026-09-10", NOW);
    expect(w.start?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(w.days).toBe(9);
    const bad = parseRange("custom", "garbage", "2026-09-10", NOW);
    expect(bad.key).toBe("custom");
    expect(bad.days).toBe(30);
  });

  it("legacy range aliases still parse", () => {
    expect(parseRange("6m", undefined, undefined, NOW).days).toBe(182);
    expect(parseRange("1y", undefined, undefined, NOW).days).toBe(365);
  });
});

describe("compareWindow", () => {
  it("shifts the window to the previous period", () => {
    const w = parseRange("7d", undefined, undefined, NOW);
    const p = compareWindow(w);
    expect(p.start?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(p.end?.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });
  it("is unbounded when the window is unbounded", () => {
    const w = parseRange("all", undefined, undefined, NOW);
    const p = compareWindow(w);
    expect(p.start).toBeNull();
    expect(p.end).toBeNull();
  });
});

describe("delta math", () => {
  it("pctChange returns null when the previous period is zero", () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(10, 5)).toBe(100);
    expect(pctChange(5, 10)).toBe(-50);
  });
  it("ppChange subtracts rates, never divides", () => {
    expect(ppChange(3.8, 3.4)).toBeCloseTo(0.4);
    expect(ppChange(null, 3.4)).toBeNull();
  });
  it("formatters carry an explicit sign and use pp for rates", () => {
    expect(fmtDeltaPct(18.44)).toBe("+18.4%");
    expect(fmtDeltaPct(-3.11)).toBe("−3.1%");
    expect(fmtDeltaPct(null)).toBe("—");
    expect(fmtDeltaPp(0.4)).toBe("+0.4pp");
    expect(fmtDeltaPp(-1.2)).toBe("−1.2pp");
  });
});

describe("denseDailyFromWindow", () => {
  it("fills gaps with zeros and stops at today (no fake future drop-off)", () => {
    const w = parseRange("7d", undefined, undefined, NOW);
    const rows = [
      { day: "2026-09-10", count: 5 },
      { day: "2026-09-12", count: 9 },
    ];
    const dense = denseDailyFromWindow(w, rows, NOW);
    expect(dense.length).toBe(7);
    expect(dense[0]).toEqual({ day: "2026-09-09", count: 0 });
    expect(dense[1]).toEqual({ day: "2026-09-10", count: 5 });
    expect(dense[3]).toEqual({ day: "2026-09-12", count: 9 });
    expect(dense[dense.length - 1]?.day).toBe("2026-09-15");
  });
});
