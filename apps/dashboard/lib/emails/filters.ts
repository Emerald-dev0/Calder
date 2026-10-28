/**
 * URL filter state for the message log.
 *
 * Every filter, the search text and the pagination cursor live here so a view
 * is shareable and survives a refresh. Parsing is total: an unknown value is
 * dropped rather than throwing, because a stale bookmark should render the
 * page, not a 404.
 *
 * `marketing` is the database value and "Broadcast" is only the UI word — the
 * enum is never renamed, and the query string carries the database value so
 * URLs stay stable if the label changes again.
 */

export type StreamFilter = "all" | "transactional" | "marketing";

export const STREAM_LABELS: Record<StreamFilter, string> = {
  all: "All",
  transactional: "Transactional",
  marketing: "Broadcast",
};

export const STATUSES = [
  "created",
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
] as const;

export type StatusFilter = "all" | (typeof STATUSES)[number];

/** Date ranges are fixed buckets so the URL stays short and the query is indexable. */
export const RANGES = ["24h", "7d", "30d", "90d", "all"] as const;
export type RangeFilter = (typeof RANGES)[number];

export const RANGE_LABELS: Record<RangeFilter, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

/** Newest-first is the default; oldest-first is for replaying an incident. */
export const SORTS = ["newest", "oldest"] as const;
export type SortFilter = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortFilter, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

/**
 * Sentinel for "sent by nobody we know about".
 *
 * Not a sender id: unattributed messages have `sender_identity_id IS NULL`, so
 * the filter cannot be an equality on an id. It lives in the URL so the senders
 * page can link straight to the exact rows behind its "N sent without a
 * registered sender" line.
 */
export const UNATTRIBUTED_SENDER = "unattributed";

export interface EmailFilters {
  stream: StreamFilter;
  sort: SortFilter;
  status: StatusFilter;
  range: RangeFilter;
  sender: string;
  domain: string;
  /** Free text: recipient, subject, our id, provider id. */
  q: string;
}

export const EMPTY_FILTERS: EmailFilters = {
  stream: "all",
  sort: "newest",
  status: "all",
  range: "all",
  sender: "",
  domain: "",
  q: "",
};

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return (s ?? "").trim();
}

/** Parse the raw search params into a validated filter object. */
export function parseFilters(params: RawParams): EmailFilters {
  const streamRaw = one(params.stream).toLowerCase();
  const statusRaw = one(params.status).toLowerCase();
  const rangeRaw = one(params.range).toLowerCase();
  const sortRaw = one(params.sort).toLowerCase();

  return {
    stream: streamRaw === "transactional" || streamRaw === "marketing" ? streamRaw : "all",
    status: (STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as StatusFilter)
      : "all",
    range: (RANGES as readonly string[]).includes(rangeRaw) ? (rangeRaw as RangeFilter) : "all",
    sort: (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as SortFilter) : "newest",
    // Sender ids are opaque; keep them only if they look like one. The
    // unattributed sentinel is the one non-id value allowed through.
    sender:
      one(params.sender) === UNATTRIBUTED_SENDER ||
      /^sender_[A-Za-z0-9_-]{1,64}$/.test(one(params.sender))
        ? one(params.sender)
        : "",
    domain: normalizeDomain(one(params.domain)),
    q: one(params.q).slice(0, 200),
  };
}

export function normalizeDomain(input: string): string {
  const d = input.trim().toLowerCase();
  if (!d) return "";
  // Hostname shape only; never let a wildcard or a URL through into SQL.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d) ? d : "";
}

/** True when any filter narrows the view (used to word empty states). */
export function hasActiveFilters(f: EmailFilters): boolean {
  return (
    f.stream !== "all" ||
    f.status !== "all" ||
    f.range !== "all" ||
    f.sender !== "" ||
    f.domain !== "" ||
    f.q !== ""
  );
}

/** Query string for the current filters, omitting defaults so URLs stay short. */
export function filtersToQuery(f: EmailFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.stream !== "all") p.set("stream", f.stream);
  if (f.status !== "all") p.set("status", f.status);
  if (f.range !== "all") p.set("range", f.range);
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (f.sender) p.set("sender", f.sender);
  if (f.domain) p.set("domain", f.domain);
  if (f.q) p.set("q", f.q);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Lower bound for a range bucket, or null for "all time". */
export function rangeStart(range: RangeFilter, now: Date = new Date()): Date | null {
  const ms: Record<Exclude<RangeFilter, "all">, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  if (range === "all") return null;
  return new Date(now.getTime() - ms[range]);
}

/**
 * Does a message id look like one of ours? Used to decide whether the search
 * term should also be matched against the id column, and to reject an
 * obviously bad `?message=` value before it reaches a query.
 */
export function looksLikeMessageId(value: string): boolean {
  return /^em_[A-Za-z0-9]{6,32}$/.test(value);
}

/** Human summary of the active filters, for the CSV filename and the banner. */
export function describeFilters(f: EmailFilters): string {
  const parts: string[] = [STREAM_LABELS[f.stream]];
  if (f.status !== "all") parts.push(f.status);
  if (f.range !== "all") parts.push(RANGE_LABELS[f.range]);
  if (f.domain) parts.push(f.domain);
  if (f.sender) parts.push(f.sender);
  if (f.q) parts.push(`"${f.q}"`);
  return parts.join(" · ");
}
