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
  it("keeps sent (provider-accepted) separate from confirmed delivered", () => {
    expect(classifyStatus("delivered")).toBe("delivered");
    expect(classifyStatus("sent")).toBe("sent");
    expect(classifyStatus("queued")).toBe("pending");
    expect(classifyStatus("created")).toBe("pending");
    expect(classifyStatus("bounced")).toBe("failed");
    expect(classifyStatus("suppressed")).toBe("failed");
  });

  it("summarizes rates over confirmed outcomes only; sent never inflates delivered", () => {
    const s = summarize([
      { status: "delivered", value: 90 },
      { status: "sent", value: 8 },
      { status: "bounced", value: 10 },
      { status: "queued", value: 5 },
    ]);
    expect(s.total).toBe(113);
    expect(s.delivered).toBe(90);
    expect(s.sent).toBe(8);
    expect(s.pending).toBe(5);
    expect(s.deliveryRate).toBeCloseTo(90);
    expect(s.failureRate).toBeCloseTo(10);
  });

  it("keeps bounce and complaint reports, which are a subset of failed", () => {
    // The Overview prints "0 bounced" only when it is a measurement. With no
    // delivery events, zero bounce reports means "nothing told us", so the page
    // needs the three numbers apart, not one `failed` total.
    const s = summarize([
      { status: "delivered", value: 1 },
      { status: "failed", value: 9 },
      { status: "sent", value: 47 },
    ]);
    expect(s.failed).toBe(9);
    expect(s.bounced).toBe(0);
    expect(s.complained).toBe(0);
    expect(s.settled).toBe(10);
    // The rate is over confirmed outcomes, so the 47 unconfirmed cannot make
    // delivery look better or worse than the 1-in-10 that was observed.
    expect(s.deliveryRate).toBeCloseTo(10);
  });

  it("counts a real bounce report as evidence the channel works", () => {
    const s = summarize([
      { status: "delivered", value: 7 },
      { status: "bounced", value: 2 },
      { status: "complained", value: 1 },
    ]);
    expect(s.failed).toBe(3);
    expect(s.bounced).toBe(2);
    expect(s.complained).toBe(1);
    expect(s.settled).toBe(10);
    expect(s.failureRate).toBeCloseTo(30);
  });

  it("reports null confirmed rates when mail is only sent, never confirmed", () => {
    const s = summarize([{ status: "sent", value: 2 }]);
    expect(s.sent).toBe(2);
    expect(s.delivered).toBe(0);
    expect(s.deliveryRate).toBeNull();
    expect(formatRate(s.deliveryRate)).toBe("—");
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
    expect(series.at(-1)).toMatchObject({
      key: "2026-10-06T20",
      label: "Now",
      delivered: 0,
      sent: 3,
    });
    expect(series[0]!.label).toBe("21:00");
  });
});
