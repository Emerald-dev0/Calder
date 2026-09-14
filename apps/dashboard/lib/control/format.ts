/**
 * Pure formatting + stat helpers for the Control Plane.
 * No DB, no React, no server-only imports — fully unit-testable.
 */

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function fmtMoney(cents: number, currency: "NGN" | "USD" = "NGN"): string {
  const symbol = currency === "NGN" ? "₦" : "$";
  const value = cents / 100;
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${symbol}${fmtInt(value)}`;
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function fmtDelta(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

/** Compact relative time: "3m ago", "2h ago", "5d ago". */
export function fmtAgo(date: Date, now: Date = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function fmtDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fmtDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
}

export type TimeRange = "7d" | "30d" | "90d" | "6m" | "1y" | "all";

export const RANGE_LABEL: Record<TimeRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
  "6m": "6M",
  "1y": "1Y",
  all: "ALL",
};

/** Range → window length in days; null = all time. */
export function rangeToDays(range: TimeRange): number | null {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "6m":
      return 182;
    case "1y":
      return 365;
    case "all":
      return null;
  }
}

export function parseRange(value: string | undefined): TimeRange {
  return value === "7d" || value === "30d" || value === "90d" || value === "6m" || value === "1y" || value === "all"
    ? value
    : "30d";
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Percentage change from previous to current; null when undefined. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

export interface DayCount {
  day: string; // YYYY-MM-DD (UTC)
  count: number;
}

/**
 * Fill a sparse per-day series into a dense one (zero-filled), oldest → newest.
 * days=null means "all": dense-fill from first activity to today instead.
 */
export function denseDaily(counts: DayCount[], days: number | null, today: Date): DayCount[] {
  const byDay = new Map(counts.map((c) => [c.day, c.count]));
  const out: DayCount[] = [];
  if (days === null) {
    const keys = [...byDay.keys()].sort();
    if (keys.length === 0) return out;
    let cursor = new Date(`${keys[0]}T00:00:00Z`);
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      out.push({ day: key, count: byDay.get(key) ?? 0 });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return out;
  }
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
  }
  return out;
}

/** Running total over a dense daily series (oldest → newest). */
export function cumulative(series: DayCount[]): DayCount[] {
  let total = 0;
  return series.map((p) => {
    total += p.count;
    return { day: p.day, count: total };
  });
}

export interface NamedCount {
  label: string;
  count: number;
}

/** Sort a distribution desc and cap the tail into an "Other" bucket. */
export function topDistribution(items: NamedCount[], max: number): NamedCount[] {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max);
  const rest = sorted.slice(max).reduce((n, r) => n + r.count, 0);
  if (rest > 0) head.push({ label: "Other", count: rest });
  return head;
}
