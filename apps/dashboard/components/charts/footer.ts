/**
 * Trend-chart tooltip footer — described as data, not as a callback.
 *
 * The charts are Client Components. React only serialises plain data across
 * the server/client boundary, so a Server Component cannot hand a Client
 * Component a function: doing it throws
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * at render time — in production that surfaces as the opaque
 * "Application error: a server-side exception has occurred" page, which is
 * exactly how /control broke. The old API was `footer: (row) => string | null`
 * and two Control pages passed inline arrows into it.
 *
 * So the footer is now a description of the computation — which two series,
 * what to divide, how to format — and the Client Component performs it. A
 * function can no longer reach the chart even by accident: the prop type
 * rejects it at compile time.
 *
 * Kept free of "use client" and of recharts imports so it stays trivially
 * testable in Node and importable from either side of the boundary.
 */

/** What the footer line should measure. Plain object: always serializable. */
export interface TrendFooterSpec {
  /** Text before the value, e.g. "Conversion that day". */
  label: string;
  /** Series key supplying the numerator. */
  numerator: string;
  /** Series key supplying the denominator. */
  denominator: string;
  /** `percent` (default) scales by 100 and appends "%"; `ratio` stays 0–1. */
  format?: "percent" | "ratio";
  /** Omit the line unless the denominator is above this. Default 0. */
  whenDenominatorAbove?: number;
  /** Decimal places. Default 1. */
  digits?: number;
}

/**
 * Resolve a footer spec for one tooltip row.
 *
 * Returns null — meaning "render nothing" — when the denominator is missing or
 * not above the threshold, so a day with no visitors cannot claim a 0%
 * conversion or divide by zero.
 */
export function footerLine(spec: TrendFooterSpec, row: Record<string, number>): string | null {
  const denominator = row[spec.denominator] ?? 0;
  const threshold = spec.whenDenominatorAbove ?? 0;
  // Written as a negated `>` so NaN also falls through to null.
  if (!(denominator > threshold)) return null;

  const numerator = row[spec.numerator] ?? 0;
  const digits = spec.digits ?? 1;
  const value = spec.format === "ratio" ? numerator / denominator : (numerator / denominator) * 100;
  const shown = spec.format === "ratio" ? value.toFixed(digits) : `${value.toFixed(digits)}%`;
  return `${spec.label}: ${shown}`;
}
