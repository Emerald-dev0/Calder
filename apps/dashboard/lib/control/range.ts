/**
 * Date range + comparison engine for the Control Plane (REQ-090/091).
 * Pure functions — no DB, no React. Fully unit-testable (NFR-010).
 * All math is UTC day-based; every delta carries its basis label.
 */

export const DAY_MS = 86_400_000;

export type RangeKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "this_month"
  | "last_month"
  | "all"
  | "custom"
  | "6m"
  | "1y";

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  all: "All time",
  custom: "Custom",
  "6m": "Last 6 months",
  "1y": "Last year",
};

export interface DateWindow {
  /** Inclusive UTC start of the current window (null = unbounded). */
  start: Date | null;
  /** Exclusive UTC end of the current window (null = unbounded). */
  end: Date | null;
  /** Same length immediately before the current window (null = unbounded). */
  compareStart: Date | null;
  compareEnd: Date | null;
  /** Human basis for deltas, e.g. "vs previous 30 days". */
  compareLabel: string;
  /** Range granularity hint: daily or weekly bucketing. */
  granularity: "daily" | "weekly";
  days: number | null;
  key: RangeKey;
}

export function utcDayStart(offsetDays = 0, now: Date = new Date()): Date {
  const d = now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  return new Date(d.toString().replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3T00:00:00.000Z"));
}

function startOfMonth(offsetMonths: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetMonths, 1));
}

/** Parse ?range= into a window. Custom uses ?from=&to= (ISO dates). */
export function parseRange(
  range: string | undefined,
  from?: string | undefined,
  to?: string | undefined,
  now: Date = new Date()
): DateWindow {
  const key = (isRangeKey(range) ? range : "30d") as RangeKey;
  const today = utcDayStart(0, now);

  const windowOf = (start: Date | null, end: Date | null, label: string): DateWindow => {
    if (start && end) {
      const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
      return {
        start,
        end,
        compareStart: new Date(start.getTime() - days * DAY_MS),
        compareEnd: start,
        compareLabel: `vs previous ${days === 1 ? "day" : `${days} days`}`,
        granularity: days > 120 ? "weekly" : "daily",
        days,
        key,
      };
    }
    return {
      start: null,
      end: null,
      compareStart: null,
      compareEnd: null,
      compareLabel: "vs all prior time",
      granularity: "daily",
      days: null,
      key,
    };
  };

  switch (key) {
    case "today":
      return windowOf(today, new Date(today.getTime() + DAY_MS), "vs yesterday");
    case "yesterday": {
      const y = new Date(today.getTime() - DAY_MS);
      return windowOf(y, today, "vs the day before");
    }
    case "7d":
      return windowOf(
        new Date(today.getTime() - 6 * DAY_MS),
        new Date(today.getTime() + DAY_MS),
        "vs previous 7 days"
      );
    case "30d":
      return windowOf(
        new Date(today.getTime() - 29 * DAY_MS),
        new Date(today.getTime() + DAY_MS),
        "vs previous 30 days"
      );
    case "90d":
      return windowOf(
        new Date(today.getTime() - 89 * DAY_MS),
        new Date(today.getTime() + DAY_MS),
        "vs previous 90 days"
      );
    case "this_month": {
      const start = startOfMonth(0, now);
      // startOfMonth subtracts its offset: -1 yields the next month's 1st.
      const end = startOfMonth(-1, now);
      return windowOf(start, end, "vs previous month");
    }
    case "last_month": {
      const start = startOfMonth(1, now);
      const end = startOfMonth(0, now);
      return windowOf(start, end, "vs the month before");
    }
    case "all":
      return {
        start: null,
        end: null,
        compareStart: null,
        compareEnd: null,
        compareLabel: "vs all prior time",
        granularity: "daily",
        days: null,
        key,
      };
    case "6m": {
      const start = new Date(today.getTime() - 181 * DAY_MS);
      return windowOf(start, new Date(today.getTime() + DAY_MS), "vs previous 6 months");
    }
    case "1y": {
      const start = new Date(today.getTime() - 364 * DAY_MS);
      return windowOf(start, new Date(today.getTime() + DAY_MS), "vs previous year");
    }
    case "custom": {
      const fromD = from ? new Date(`${from}T00:00:00.000Z`) : null;
      const toD = to ? new Date(`${to}T00:00:00.000Z`) : null;
      if (
        !fromD ||
        !toD ||
        Number.isNaN(fromD.getTime()) ||
        Number.isNaN(toD.getTime()) ||
        toD <= fromD
      ) {
        // Fall back to 30d on malformed custom input (never throw from URL state).
        const s = new Date(today.getTime() - 29 * DAY_MS);
        return windowOf(s, new Date(today.getTime() + DAY_MS), "vs previous 30 days");
      }
      return windowOf(fromD, toD, "vs previous period");
    }
  }
}

function isRangeKey(v: string | undefined): v is RangeKey {
  return !!v && [
    "today",
    "yesterday",
    "7d",
    "30d",
    "90d",
    "this_month",
    "last_month",
    "all",
    "custom",
    "6m",
    "1y",
  ].includes(v);
}

/** The previous-period window for the same key (for delta queries). */
export function compareWindow(w: DateWindow): DateWindow {
  if (!w.compareStart || !w.compareEnd) {
    return { ...w, start: null, end: null, compareStart: null, compareEnd: null };
  }
  return { ...w, start: w.compareStart, end: w.compareEnd, compareStart: null, compareEnd: null };
}

/** Relative change of a count metric: null when the previous period is 0. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Change of a rate in percentage points (never relative % for rates). */
export function ppChange(currentPct: number | null, previousPct: number | null): number | null {
  if (currentPct === null || previousPct === null) return null;
  return currentPct - previousPct;
}

/** Format a delta for display: "+18.4%" / "−3.1%" / "—". */
export function fmtDeltaPct(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

/** Format a percentage-point delta: "+0.4pp". */
export function fmtDeltaPp(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}pp`;
}

/** "1m 42s" style durations. */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** YYYY-MM-DD in UTC for a given date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dense day series (fills gaps with 0) between window start and end. */
export function denseDailyFromWindow(
  window: DateWindow,
  rows: Array<{ day: string; count: number }>,
  now: Date = new Date()
): Array<{ day: string; count: number }> {
  if (!window.start || !window.end) return rows; // all-time: use rows as-is
  const out: Array<{ day: string; count: number }> = [];
  const lastDataDay = isoDay(now);
  for (let t = window.start.getTime(); t < window.end.getTime(); t += DAY_MS) {
    const day = isoDay(new Date(t));
    const row = rows.find((r) => r.day === day);
    // Future days in the current window (e.g. "Last 7 days" ending tomorrow)
    // are only rendered up to today to avoid a fake drop-off.
    if (day > lastDataDay) break;
    out.push({ day, count: row ? row.count : 0 });
  }
  return out;
}
