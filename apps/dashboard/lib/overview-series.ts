/**
 * Pure helpers that turn grouped email-status counts into the Overview
 * page's metrics and volume series. No DB access: the page queries, these
 * shape. All bucketing is UTC so server and client agree.
 */

export type StatusClass = "delivered" | "failed" | "pending";
export type StatusTone = "success" | "info" | "warning" | "danger" | "neutral";

export function classifyStatus(status: string): StatusClass {
  if (status === "sent" || status === "delivered") return "delivered";
  if (status === "queued" || status === "sending" || status === "created") return "pending";
  return "failed";
}

export function statusTone(status: string): StatusTone {
  switch (status) {
    case "delivered":
      return "success";
    case "sent":
    case "sending":
      return "info";
    case "queued":
    case "created":
      return "warning";
    case "bounced":
    case "complained":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export interface StatusCountRow {
  status: string;
  value: number;
}

export interface BucketCountRow extends StatusCountRow {
  bucket: string;
}

export interface VolumeSummary {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  /** delivered / settled (delivered + failed), 0–100. null when nothing settled. */
  deliveryRate: number | null;
  /** failed / settled, 0–100. null when nothing settled. */
  failureRate: number | null;
}

export function summarize(rows: StatusCountRow[]): VolumeSummary {
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rows) {
    const cls = classifyStatus(r.status);
    if (cls === "delivered") delivered += r.value;
    else if (cls === "failed") failed += r.value;
    else pending += r.value;
  }
  const settled = delivered + failed;
  return {
    total: delivered + failed + pending,
    delivered,
    failed,
    pending,
    deliveryRate: settled > 0 ? (delivered / settled) * 100 : null,
    failureRate: settled > 0 ? (failed / settled) * 100 : null,
  };
}

export interface SeriesPoint {
  key: string;
  label: string;
  delivered: number;
  failed: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function hourKey(d: Date): string {
  return d.toISOString().slice(0, 13);
}

function fill(rows: BucketCountRow[]): Map<string, { delivered: number; failed: number }> {
  const map = new Map<string, { delivered: number; failed: number }>();
  for (const r of rows) {
    const cls = classifyStatus(r.status);
    if (cls === "pending") continue;
    const cur = map.get(r.bucket) ?? { delivered: 0, failed: 0 };
    cur[cls] += r.value;
    map.set(r.bucket, cur);
  }
  return map;
}

/** One point per UTC day, oldest first, ending today. Missing days are zero. */
export function buildDailySeries(rows: BucketCountRow[], days: number, now: Date): SeriesPoint[] {
  const map = fill(rows);
  const out: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    const key = dayKey(d);
    const label =
      i === 0
        ? "Today"
        : days <= 7
          ? WEEKDAYS[d.getUTCDay()]!
          : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
    const v = map.get(key) ?? { delivered: 0, failed: 0 };
    out.push({ key, label, ...v });
  }
  return out;
}

/** One point per UTC hour, oldest first, ending with the current hour. */
export function buildHourlySeries(rows: BucketCountRow[], hours: number, now: Date): SeriesPoint[] {
  const map = fill(rows);
  const out: SeriesPoint[] = [];
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * HOUR_MS);
    const key = hourKey(d);
    const label = i === 0 ? "Now" : `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    const v = map.get(key) ?? { delivered: 0, failed: 0 };
    out.push({ key, label, ...v });
  }
  return out;
}

export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate >= 99.95 || rate === 0 ? rate.toFixed(0) : rate.toFixed(1)}%`;
}
