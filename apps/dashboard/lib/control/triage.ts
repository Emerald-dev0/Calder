/**
 * Support triage: the queue an operator works from, built only from signals
 * that already exist in the database.
 *
 * The Control Plane has no ticket table, and inventing one would produce a
 * second, emptier place to look — every row in a real ticketing system starts
 * as somebody telling us something we already recorded. So this module turns
 * the states we *do* store (a paused workspace, a domain stuck on DNS, a
 * webhook that exhausted its retries, a purge about to happen) into ranked
 * work items, each linking to the record that needs attention.
 *
 * The ranking is deliberately opinionated:
 *
 *   critical — a customer cannot send, or data is about to disappear.
 *   high     — something is failing now and the customer probably does not know.
 *   normal   — waiting on the customer, or a state worth a weekly sweep.
 *
 * Pure by design: every row arrives as an argument, so the ranking and the
 * copy can be tested without a database. `triageQueue()` in queries.ts does
 * the reads and reports any signal it could not load — an unreadable signal
 * must never render as "no problems".
 */

export type TriageSeverity = "critical" | "high" | "normal";

export type TriageKind =
  | "workspace-paused"
  | "deletion-pending"
  | "domain-stuck"
  | "domain-failed"
  | "webhook-exhausted"
  | "sends-failing"
  | "sender-blocked"
  | "transport-revoked";

export interface TriageItem {
  /** Stable across renders so React keys and dedupe behave. */
  id: string;
  kind: TriageKind;
  severity: TriageSeverity;
  /** One line: what is wrong, with the customer's own name in it. */
  title: string;
  /** Supporting fact: why, since when, how many. */
  detail: string;
  href: string;
  organizationName: string;
  /** When the condition started, when the row knows. Used only for ordering. */
  since: Date | null;
}

export interface TriageCounts {
  total: number;
  critical: number;
  high: number;
  normal: number;
}

/**
 * Every signal this queue reads. Exported so the page can show what *was*
 * checked — an empty queue means "seven signals are quiet", not "the page
 * forgot to look".
 */
export const TRIAGE_SIGNALS = [
  "workspaces paused or suspended",
  "workspaces awaiting deletion",
  "domains that are not verified",
  "webhook deliveries that gave up",
  "projects with failing sends",
  "sender identities blocked by verification",
  "transports withdrawn by a provider",
] as const;

export type TriageSignal = (typeof TRIAGE_SIGNALS)[number];

export interface TriageQueue {
  items: TriageItem[];
  counts: TriageCounts;
  /** Signals that could not be read this render, named so silence is not mistaken for calm. */
  unreadable: string[];
  /** Signals the queue attempted, whether or not they produced items. */
  checked: string[];
}

export interface PausedWorkspaceRow {
  id: string;
  name: string;
  status: "abuse_paused" | "suspended";
  sendingStatusReason: string | null;
  sendingStatusAt: Date | null;
}

export interface PendingDeletionRow {
  id: string;
  name: string;
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date;
}

export interface ProblemDomainRow {
  id: string;
  domain: string;
  status: "pending" | "failed" | "expired";
  organizationId: string;
  organizationName: string;
  createdAt: Date;
  lastVerifyError: string | null;
}

export interface FailingWebhookRow {
  id: string;
  url: string;
  organizationName: string;
  failedAttempts: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
}

export interface FailingProjectRow {
  projectId: string;
  projectName: string;
  organizationId: string;
  organizationName: string;
  failed: number;
  bounced: number;
  windowHours: number;
}

export interface BlockedSenderRow {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  status: "failed" | "disabled";
  statusReason: string | null;
  updatedAt: Date;
}

export interface RevokedTransportRow {
  id: string;
  label: string;
  type: string;
  organizationId: string;
  organizationName: string;
  updatedAt: Date;
}

export interface TriageInput {
  now: Date;
  pausedWorkspaces: PausedWorkspaceRow[];
  pendingDeletions: PendingDeletionRow[];
  problemDomains: ProblemDomainRow[];
  failingWebhooks: FailingWebhookRow[];
  failingProjects: FailingProjectRow[];
  blockedSenders: BlockedSenderRow[];
  revokedTransports: RevokedTransportRow[];
}

export const SEVERITY_LABEL: Record<TriageSeverity, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
};

const RANK: Record<TriageSeverity, number> = { critical: 0, high: 1, normal: 2 };

/** A pending domain is "stuck" once the customer has had a full day to add a DNS record. */
export const DOMAIN_STUCK_AFTER_HOURS = 24;

/** A project shows up here once this many sends failed inside the window. */
export const FAILING_SENDS_THRESHOLD = 3;

/** Webhook retries exhausted: the endpoint never accepted the event. */
export const WEBHOOK_FAILED_THRESHOLD = 1;

export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function relativeHours(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(Math.round(hours), "hour");
  return plural(Math.round(hours / 24), "day");
}

function sinceText(since: Date | null, now: Date): string {
  if (!since) return "since an unknown time";
  const h = Math.max(0, hoursBetween(since, now));
  return `since ${relativeHours(h)} ago`;
}

/**
 * Rank order: severity first, then oldest first — the longest-suffering
 * customer is the one most likely to have given up quietly.
 */
export function sortTriageItems(items: TriageItem[]): TriageItem[] {
  return [...items].sort((a, b) => {
    const byRank = RANK[a.severity] - RANK[b.severity];
    if (byRank !== 0) return byRank;
    const at = a.since ? a.since.getTime() : Number.POSITIVE_INFINITY;
    const bt = b.since ? b.since.getTime() : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

export function countTriage(items: TriageItem[]): TriageCounts {
  const counts: TriageCounts = { total: items.length, critical: 0, high: 0, normal: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

export function buildTriageQueue(input: TriageInput): TriageQueue {
  const { now } = input;
  const items: TriageItem[] = [];

  for (const w of input.pausedWorkspaces) {
    const suspended = w.status === "suspended";
    items.push({
      id: `workspace-paused:${w.id}`,
      kind: "workspace-paused",
      // Sending is stopped for every project in the workspace, so nothing the
      // customer does in the product can succeed until this is resolved.
      severity: "critical",
      title: `${w.name} cannot send — ${suspended ? "suspended" : "paused for abuse"}`,
      detail: [
        suspended ? "Operators suspended this workspace." : "Automatic abuse feedback paused it.",
        w.sendingStatusReason ? `Reason: ${w.sendingStatusReason}.` : "No reason recorded.",
        `Set ${sinceText(w.sendingStatusAt, now)}.`,
      ].join(" "),
      href: `/control/customers/organizations/${w.id}`,
      organizationName: w.name,
      since: w.sendingStatusAt,
    });
  }

  for (const d of input.pendingDeletions) {
    const hoursLeft = hoursBetween(now, d.deletionScheduledFor);
    const overdue = hoursLeft <= 0;
    items.push({
      id: `deletion-pending:${d.id}`,
      kind: "deletion-pending",
      // Irreversible from the moment the sweep runs; the customer can still
      // cancel, but only if somebody notices in time.
      severity: overdue || hoursLeft <= 24 ? "critical" : hoursLeft <= 72 ? "high" : "normal",
      title: overdue ? `${d.name} is due for purge` : `${d.name} is scheduled for deletion`,
      detail: overdue
        ? "The grace window has closed; the next maintenance sweep purges it."
        : `Purges in ${relativeHours(hoursLeft)} unless the workspace cancels. Requested ${sinceText(
            d.deletionRequestedAt,
            now
          )}.`,
      href: `/control/customers/organizations/${d.id}`,
      organizationName: d.name,
      since: d.deletionScheduledFor,
    });
  }

  for (const d of input.problemDomains) {
    const ageHours = Math.max(0, hoursBetween(d.createdAt, now));
    if (d.status === "pending" && ageHours < DOMAIN_STUCK_AFTER_HOURS) continue;
    const failed = d.status !== "pending";
    items.push({
      id: `domain:${d.id}`,
      kind: failed ? "domain-failed" : "domain-stuck",
      // A failed or expired challenge blocks every sender on that domain; a
      // pending one is only worth chasing once the customer has had a day.
      severity: failed ? "high" : "normal",
      title: `${d.domain} is ${failed ? d.status : "still pending"} after ${relativeHours(ageHours)}`,
      detail: [
        failed
          ? "Ownership verification did not complete, so this domain cannot send."
          : "Waiting on a DNS record. Nothing can be proven until it is published.",
        d.lastVerifyError ? `Last error: ${d.lastVerifyError}.` : "No verification error recorded.",
      ].join(" "),
      href: `/control/customers/domains?status=${d.status}&q=${encodeURIComponent(d.domain)}`,
      organizationName: d.organizationName,
      since: d.createdAt,
    });
  }

  for (const w of input.failingWebhooks) {
    if (w.failedAttempts < WEBHOOK_FAILED_THRESHOLD) continue;
    items.push({
      id: `webhook-exhausted:${w.id}`,
      kind: "webhook-exhausted",
      severity: "high",
      title: `Webhook stopped delivering to ${hostOf(w.url)}`,
      detail: [
        `${plural(w.failedAttempts, "delivery", "deliveries")} exhausted every retry${
          w.lastAttemptAt ? ` (last ${sinceText(w.lastAttemptAt, now)})` : ""
        }.`,
        w.lastError ? `Last error: ${w.lastError}.` : "No error text recorded.",
        "The customer's endpoint never accepted these events; they will not replay themselves.",
      ].join(" "),
      href: "/control/platform/webhooks",
      organizationName: w.organizationName,
      since: w.lastAttemptAt,
    });
  }

  for (const p of input.failingProjects) {
    if (p.failed < FAILING_SENDS_THRESHOLD) continue;
    items.push({
      id: `sends-failing:${p.projectId}`,
      kind: "sends-failing",
      severity: "high",
      title: `${p.projectName}: ${plural(p.failed, "send")} failed in ${relativeHours(
        p.windowHours
      )}`,
      detail: [
        "The provider accepted the message and then refused or could not deliver it.",
        p.bounced > 0
          ? `${plural(p.bounced, "message")} bounced — check the recipient domain and the sender's DNS.`
          : "No bounces recorded, so the failure is on the sending side.",
        "Each row has its own error in Observability → Logs.",
      ].join(" "),
      href: "/control/customers/projects",
      organizationName: p.organizationName,
      since: null,
    });
  }

  for (const s of input.blockedSenders) {
    items.push({
      id: `sender-blocked:${s.id}`,
      kind: "sender-blocked",
      severity: "high",
      title: `Sender ${s.email} is ${s.status}`,
      detail: [
        s.status === "failed"
          ? "Verification failed, so mail from this identity is refused."
          : "Disabled on purpose; sends through it will be rejected.",
        s.statusReason ? `Reason: ${s.statusReason}.` : "No reason recorded.",
        `Changed ${sinceText(s.updatedAt, now)}.`,
      ].join(" "),
      href: `/control/customers/organizations/${s.organizationId}`,
      organizationName: s.organizationName,
      since: s.updatedAt,
    });
  }

  for (const t of input.revokedTransports) {
    items.push({
      id: `transport-revoked:${t.id}`,
      kind: "transport-revoked",
      severity: "high",
      title: `${t.type} transport ${t.label} was revoked`,
      detail: [
        "The provider withdrew access, so sends through this transport stop immediately.",
        `Changed ${sinceText(t.updatedAt, now)}.`,
        "The customer has to reconnect; nothing on our side can restore it.",
      ].join(" "),
      href: `/control/customers/organizations/${t.organizationId}`,
      organizationName: t.organizationName,
      since: t.updatedAt,
    });
  }

  const sorted = sortTriageItems(items);
  return {
    items: sorted,
    counts: countTriage(sorted),
    unreadable: [],
    checked: [...TRIAGE_SIGNALS],
  };
}

/** Host of a webhook URL for a readable title; the path is not the operator's problem. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
