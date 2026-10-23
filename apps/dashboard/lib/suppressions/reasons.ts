/**
 * IMPORTANT: this module is imported by client components. It must not import
 * `@calder/db` — that package pulls the Postgres driver and BullMQ into the
 * browser bundle. The canonical list is therefore restated here and held to the
 * database constant by `reasons.test.ts`, which runs in Node and may import it.
 */
export const CANONICAL_REASONS = [
  "bounce",
  "complaint",
  "unsubscribe",
  "manual",
  "soft_bounce_repeated",
  "import",
] as const;

export type CanonicalReason = (typeof CANONICAL_REASONS)[number];

/**
 * Display layer for suppression reasons.
 *
 * The database stores `reason` as free text on purpose (the public API accepts
 * a free-form value and old rows predate the constant), so the UI has to be
 * total: a known reason gets a reviewed label and tone, anything else gets a
 * readable fallback rather than a blank cell or a crash.
 *
 * Every page that shows a reason must import from here, so `unsubscribe` looks
 * the same in the table, the filter tabs and the CSV export.
 */

export type ReasonTone = "danger" | "warning" | "info" | "neutral";

export interface ReasonMeta {
  /** Canonical stored value (may be arbitrary text for legacy rows). */
  value: string;
  /** Human label. */
  label: string;
  /** One-line explanation, used in the filter menu and the detail tooltip. */
  hint: string;
  tone: ReasonTone;
  /** True for reasons the recipient chose, which never block transactional mail. */
  marketingOnly: boolean;
  /** True for reasons that apply across the whole organization. */
  orgWide: boolean;
}

const KNOWN: Record<CanonicalReason, Omit<ReasonMeta, "value">> = {
  bounce: {
    label: "Bounced",
    hint: "Hard bounce — the mailbox is permanently undeliverable. Blocks all mail, workspace-wide.",
    tone: "danger",
    marketingOnly: false,
    orgWide: true,
  },
  complaint: {
    label: "Complaint",
    hint: "The recipient marked this mail as spam. Blocks all mail, workspace-wide.",
    tone: "danger",
    marketingOnly: false,
    orgWide: true,
  },
  unsubscribe: {
    label: "Unsubscribed",
    hint: "The recipient opted out of broadcasts. Blocks broadcast mail only, in this project.",
    tone: "info",
    marketingOnly: true,
    orgWide: false,
  },
  manual: {
    label: "Manual block",
    hint: "Added by hand from the dashboard or API. Blocks all mail, in this project.",
    tone: "neutral",
    marketingOnly: false,
    orgWide: false,
  },
  soft_bounce_repeated: {
    label: "Repeated soft bounce",
    hint: "The mailbox repeatedly deferred delivery. Blocks all mail, in this project.",
    tone: "warning",
    marketingOnly: false,
    orgWide: false,
  },
  import: {
    label: "Imported",
    hint: "Came from a CSV import. Blocks all mail, in this project.",
    tone: "neutral",
    marketingOnly: false,
    orgWide: false,
  },
};

/**
 * Legacy values that were written before the constant existed. Kept explicit so
 * they read correctly instead of falling through to the generic fallback.
 */
const LEGACY: Record<string, Omit<ReasonMeta, "value">> = {
  complained: KNOWN.complaint,
  unsubscribed: KNOWN.unsubscribe,
  hard_bounce: {
    label: "Bounced",
    hint: "Hard bounce recorded before reasons were normalised. Blocks all mail.",
    tone: "danger",
    marketingOnly: false,
    orgWide: false,
  },
  soft_bounce: {
    label: "Soft bounce",
    hint: "A transient failure that has since been retried.",
    tone: "warning",
    marketingOnly: false,
    orgWide: false,
  },
  abuse: {
    label: "Abuse report",
    hint: "Reported as abusive. Blocks all mail, in this project.",
    tone: "danger",
    marketingOnly: false,
    orgWide: false,
  },
};

/** Turn arbitrary stored text into a readable label: "abuse_report" -> "Abuse report". */
function humanize(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "Unknown reason";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function reasonMeta(value: string): ReasonMeta {
  const key = value.trim().toLowerCase();
  const known = KNOWN[key as CanonicalReason] ?? LEGACY[key];
  if (known) return { value, ...known };
  return {
    value,
    label: humanize(key),
    hint: "A reason this version of the dashboard does not recognise. Treated as a block on all mail in this project.",
    tone: "neutral",
    marketingOnly: false,
    orgWide: false,
  };
}

/** Map a tone onto the design system's StatusPill status vocabulary. */
export function reasonPillStatus(value: string): string {
  const meta = reasonMeta(value);
  switch (meta.tone) {
    case "danger":
      return value.trim().toLowerCase() === "complaint" ? "complaint" : "bounce";
    case "warning":
      return "pending";
    case "info":
      return "suppressed";
    default:
      return "manual";
  }
}

/** Filter tabs. "all" plus one tab per canonical reason, with live counts. */
export interface ReasonTab {
  value: string;
  label: string;
  count: number;
}

export function buildTabs(counts: Array<{ reason: string; count: number }>): ReasonTab[] {
  const byReason = new Map<string, number>();
  for (const row of counts) {
    const key = row.reason.trim().toLowerCase();
    byReason.set(key, (byReason.get(key) ?? 0) + row.count);
  }
  const total = [...byReason.values()].reduce((a, b) => a + b, 0);
  const tabs: ReasonTab[] = [{ value: "all", label: "All", count: total }];
  for (const reason of CANONICAL_REASONS) {
    tabs.push({ value: reason, label: KNOWN[reason].label, count: byReason.get(reason) ?? 0 });
  }
  // Surface anything stored that is not in the constant, so legacy rows are
  // never invisible (and never silently un-removable).
  for (const [reason, count] of [...byReason.entries()].sort()) {
    if ((CANONICAL_REASONS as readonly string[]).includes(reason)) continue;
    tabs.push({ value: reason, label: reasonMeta(reason).label, count });
  }
  return tabs;
}

/** Reasons an operator may choose when adding by hand. */
export const ADDABLE_REASONS = CANONICAL_REASONS.map((r) => ({
  value: r,
  label: KNOWN[r].label,
  hint: KNOWN[r].hint,
}));

/** Removing one of these undoes a signal the provider sent us. Warn hard. */
export function removalIsDangerous(value: string): boolean {
  const key = value.trim().toLowerCase();
  return key === "bounce" || key === "complaint" || key === "hard_bounce" || key === "abuse";
}
