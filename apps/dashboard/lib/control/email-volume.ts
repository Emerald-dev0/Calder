/**
 * Platform-wide email volume — the counting rules, without the database.
 *
 * Split from `queries.ts` so the rules below can be tested directly, and so a
 * page cannot re-derive "how many emails has this platform sent" a second way.
 * The query in `queries.ts` only supplies rows; every number an admin reads is
 * assembled here.
 */

/**
 * What counts as a send.
 *
 * `sent`, `delivered`, `bounced` and `complained` all mean the provider took
 * the message. A row still in `created`/`queued`/`sending` has not left Calder,
 * and `failed`/`suppressed` never reached the provider at all — counting either
 * as "sent" would inflate the number an admin quotes to a customer.
 */
export const ACCEPTED_EMAIL_STATUSES = ["sent", "delivered", "bounced", "complained"] as const;

/** Display order for the ledger breakdown. Anything else falls to the end. */
const EMAIL_STATUS_ORDER: readonly string[] = [
  "created",
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
];

export interface PlatformEmailVolume {
  /** Provider-accepted sends from live keys — the platform's real volume. */
  liveAccepted: number;
  /**
   * Provider-accepted sends from test-mode keys. MOCKED at the provider
   * boundary and never billed, so they are reported beside the real number,
   * never inside it.
   */
  testAccepted: number;
  /** Every email row ever created, any status, either environment. */
  lifetimeRows: number;
  /** Live rows per status in canonical order; zero-count statuses omitted. */
  byStatus: Array<{ status: string; count: number }>;
  /** Oldest and newest accepted live send, or null when nothing has gone out. */
  firstAcceptedAt: Date | null;
  lastAcceptedAt: Date | null;
  /** Organizations with at least one accepted live send. */
  sendingOrgs: number;
}

/**
 * Assembles the query results. Kept pure so the counting rules above are
 * testable without a database, and so the page cannot re-derive them
 * differently.
 */
export function summarisePlatformEmailVolume(input: {
  envRows: Array<{ env: string; value: unknown }>;
  statusRows: Array<{ status: string; value: unknown }>;
  lifetimeRows: unknown;
  firstAcceptedAt: Date | null;
  lastAcceptedAt: Date | null;
  sendingOrgs: unknown;
}): PlatformEmailVolume {
  const envCount = (name: string) => Number(input.envRows.find((r) => r.env === name)?.value ?? 0);
  const counts = new Map(input.statusRows.map((r) => [r.status, Number(r.value ?? 0)]));
  const ordered = [...EMAIL_STATUS_ORDER];
  for (const row of input.statusRows) {
    if (!ordered.includes(row.status)) ordered.push(row.status);
  }
  const byStatus = ordered
    .map((status) => ({ status, count: counts.get(status) ?? 0 }))
    .filter((row) => row.count > 0);
  return {
    liveAccepted: envCount("live"),
    testAccepted: envCount("test"),
    lifetimeRows: Number(input.lifetimeRows ?? 0),
    byStatus,
    firstAcceptedAt: input.firstAcceptedAt,
    lastAcceptedAt: input.lastAcceptedAt,
    sendingOrgs: Number(input.sendingOrgs ?? 0),
  };
}

/**
 * Platform-wide email volume over all time, every organization.
 *
 * The windowless counterpart to `emailTotals(30)`: an admin asking "how many
 * emails has this platform sent" means since the beginning, not since last
 * month.
 */
