/**
 * Inbound mail, summarised without flattering itself.
 *
 * Receiving has two independent health questions and the Control Plane used to
 * answer neither: are we accepting mail for the domains customers configured
 * (MX + TXT proof), and is the mail we accept actually being processed (parse
 * failures, unrouted messages)? They fail in different ways and neither is
 * visible from the sending side — a project can have perfect outbound delivery
 * and silently reject every reply.
 *
 * Pure so the arithmetic is testable without a database, and deliberately
 * conservative: a rate over zero events is `null`, never `0%`, because "nothing
 * failed" and "nothing arrived" are the two facts an operator must be able to
 * tell apart.
 */

export type InboundStatus = "received" | "parsed" | "routed" | "failed" | "rejected";

export type ReceivingDomainStatus = "pending" | "verifying" | "verified" | "failed" | "disabled";

export interface InboundStatusCounts {
  received: number;
  parsed: number;
  routed: number;
  failed: number;
  rejected: number;
}

export interface ReceivingDomainCounts {
  total: number;
  verified: number;
  pending: number;
  verifying: number;
  failed: number;
  disabled: number;
}

export interface InboundSummary {
  windowDays: number;
  /** Messages that arrived, by terminal state. */
  counts: InboundStatusCounts;
  total: number;
  domains: ReceivingDomainCounts;
  inboxes: number;
  /** Parsed-but-unassigned: mail nobody is being shown. */
  unrouted: number;
  /**
   * Share of *processed* messages that failed to parse. Null when nothing was
   * processed — an empty inbox is not a 0% failure rate.
   */
  parseFailureRate: number | null;
  /** Share of domains that finished ownership proof. Null when there are none. */
  domainVerifiedRate: number | null;
}

export function emptyStatusCounts(): InboundStatusCounts {
  return { received: 0, parsed: 0, routed: 0, failed: 0, rejected: 0 };
}

export function summariseInbound(input: {
  windowDays: number;
  statusRows: Array<{ status: InboundStatus; n: number | string }>;
  domainRows: Array<{ status: ReceivingDomainStatus; n: number | string }>;
  inboxes: number;
  unrouted: number;
}): InboundSummary {
  const counts = emptyStatusCounts();
  for (const row of input.statusRows) {
    // Unknown statuses were made impossible by the enum, but a row arriving
    // from a future value must not corrupt the total, so only known keys count.
    if (row.status in counts) counts[row.status] += Number(row.n);
  }
  const total = counts.received + counts.parsed + counts.routed + counts.failed + counts.rejected;

  const domains: ReceivingDomainCounts = {
    total: 0,
    verified: 0,
    pending: 0,
    verifying: 0,
    failed: 0,
    disabled: 0,
  };
  for (const row of input.domainRows) {
    if (row.status in domains) domains[row.status] += Number(row.n);
    domains.total += Number(row.n);
  }

  // "Processed" excludes `received` (still queued) and `rejected` (a decision,
  // not a failure): folding either into the denominator would let a backlog or
  // a policy refusal look like a parser problem.
  const processed = counts.parsed + counts.routed + counts.failed;
  const parseFailureRate = processed > 0 ? (counts.failed / processed) * 100 : null;
  const domainVerifiedRate = domains.total > 0 ? (domains.verified / domains.total) * 100 : null;

  return {
    windowDays: input.windowDays,
    counts,
    total,
    domains,
    inboxes: input.inboxes,
    unrouted: input.unrouted,
    parseFailureRate,
    domainVerifiedRate,
  };
}
