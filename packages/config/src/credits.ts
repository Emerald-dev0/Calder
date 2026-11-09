/**
 * Prepaid capacity products — commercial configuration, not DB state.
 *
 * Two products, deliberately separate:
 *  - Monthly email credits add volume after a plan's included monthly
 *    allowance is exhausted. They carry forward and each purchase expires
 *    `CREDIT_EXPIRY_MONTHS` after that purchase.
 *  - Daily burst passes add temporary *daily* capacity for one UTC day. They
 *    never add monthly credits and never bypass the monthly allowance.
 *
 * No automatic purchase or overage exists: a credit is granted only after a
 * verified payment. Prices are integer USD cents, never floats.
 */

export const CREDIT_CURRENCY = "USD" as const;
export type CreditCurrency = typeof CREDIT_CURRENCY;

export interface CreditPack {
  id: "small" | "medium" | "large";
  name: string;
  credits: number;
  /** USD cents. */
  amountCents: number;
  /** Human copy, kept in sync with the price by construction. */
  displayPrice: string;
}

export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "small", name: "Small pack", credits: 1_000, amountCents: 200, displayPrice: "$2" },
  { id: "medium", name: "Medium pack", credits: 3_000, amountCents: 500, displayPrice: "$5" },
  { id: "large", name: "Large pack", credits: 10_000, amountCents: 1_500, displayPrice: "$15" },
] as const;

export type CreditPackId = CreditPack["id"];

export function creditPackById(id: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

export const CREDIT_EXPIRY_MONTHS = 12;

/**
 * Daily burst pass: $1 for +1,000 recipient submissions, valid until 23:59:59
 * UTC on the purchase day. Capped at two per account per UTC day.
 */
export const DAILY_BURST_PASS = {
  id: "daily_burst_pass",
  name: "Daily Burst Pass",
  additionalCapacity: 1_000,
  amountCents: 100,
  displayPrice: "$1",
  maxPerUtcDay: 2,
} as const;

export type BurstPassId = typeof DAILY_BURST_PASS.id;

/** End of the UTC day containing `now` (exclusive). */
export function endOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
}

/** Calendar date key (`YYYY-MM-DD`) in UTC, used for the per-day pass cap. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Expiry instant for a credit purchase made at `purchasedAt`. */
export function creditExpiry(purchasedAt: Date): Date {
  const expiry = new Date(purchasedAt);
  expiry.setUTCMonth(expiry.getUTCMonth() + CREDIT_EXPIRY_MONTHS);
  return expiry;
}

/** Format integer USD cents as `$12.34` / `$12`. */
export function formatUsdCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const part = Math.abs(cents % 100);
  return part === 0
    ? `$${whole.toLocaleString("en-US")}`
    : `$${whole}.${String(part).padStart(2, "0")}`;
}

/** Public plan price, always USD. NGN is intentionally not a public price. */
export function formatUsdPrice(cents: number): string {
  return formatUsdCents(cents);
}
