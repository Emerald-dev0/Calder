import { describe, it, expect } from "vitest";
import {
  buildDailySeries,
  buildHourlySeries,
  classifyStatus,
  formatRate,
  summarize,
} from "./overview-series";

const NOW = new Date("2026-10-06T20:30:00Z");

describe("overview series", () => {
  it("classifies statuses into delivered / failed / pending", () => {
    expect(classifyStatus("delivered")).toBe("delivered");
    expect(classifyStatus("sent")).toBe("delivered");
    expect(classifyStatus("queued")).toBe("pending");
    expect(classifyStatus("created")).toBe("pending");
    expect(classifyStatus("bounced")).toBe("failed");
    expect(classifyStatus("suppressed")).toBe("failed");
  });

  it("summarizes rates over settled messages only", () => {
    const s = summarize([
      { status: "delivered", value: 90 },
      { status: "bounced", value: 10 },
      { status: "queued", value: 5 },
    ]);
    expect(s.total).toBe(105);
    expect(s.pending).toBe(5);
    expect(s.deliveryRate).toBeCloseTo(90);
    expect(s.failureRate).toBeCloseTo(10);
  });

  it("reports null rates when nothing has settled", () => {
    const s = summarize([{ status: "queued", value: 3 }]);
    expect(s.deliveryRate).toBeNull();
    expect(formatRate(s.deliveryRate)).toBe("—");
  });

  it("fills missing days with zeros and ends on today", () => {
    const series = buildDailySeries(
      [
        { bucket: "2026-10-06", status: "delivered", value: 4 },
        { bucket: "2026-10-04", status: "failed", value: 2 },
        { bucket: "2026-10-04", status: "queued", value: 9 },
      ],
      7,
      NOW
    );
    expect(series).toHaveLength(7);
    expect(series.at(-1)).toMatchObject({ key: "2026-10-06", label: "Today", delivered: 4 });
    expect(series.find((p) => p.key === "2026-10-04")).toMatchObject({ delivered: 0, failed: 2 });
    expect(series[0]!.key).toBe("2026-09-30");
  });

  it("labels 30-day series with month/day", () => {
    const series = buildDailySeries([], 30, NOW);
    expect(series[0]!.label).toBe("Sep 7");
  });

  it("builds hourly buckets ending at the current hour", () => {
    const series = buildHourlySeries(
      [{ bucket: "2026-10-06T20", status: "sent", value: 3 }],
      24,
      NOW
    );
    expect(series).toHaveLength(24);
    expect(series.at(-1)).toMatchObject({ key: "2026-10-06T20", label: "Now", delivered: 3 });
    expect(series[0]!.label).toBe("21:00");
  });
});
