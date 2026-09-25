/**
 * Plan limits — the single source of truth for quota semantics in code
 * (PRICING.md §1 + §5: "Hard limits, no silent overages", "Test-key traffic
 * is never metered"). Tier NAMES are the DB enum (free/starter/pro/scale);
 * display names are the marketing table (Beginner/Pro/Premium/Scale).
 *
 * One emails row = one unit of usage, whatever the recipient count (per-
 * recipient billing is a future pricing change, not Phase 2 scope).
 */

export type PlanTier = "free" | "starter" | "pro" | "scale";

export interface PlanLimit {
  tier: PlanTier;
  displayName: string;
  /** null = custom/contract (no platform-enforced ceiling). */
  emailsPerMonth: number | null;
  /** Marketing contacts allowance (campaigns are post-MVP; kept for parity). */
  contacts: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  free: { tier: "free", displayName: "Beginner", emailsPerMonth: 5_000, contacts: 1_000 },
  starter: { tier: "starter", displayName: "Pro", emailsPerMonth: 50_000, contacts: 10_000 },
  pro: { tier: "pro", displayName: "Premium", emailsPerMonth: 250_000, contacts: 50_000 },
  scale: { tier: "scale", displayName: "Scale", emailsPerMonth: null, contacts: null },
};

/**
 * Emails/month ceiling for a tier. Unknown tiers resolve to the free floor:
 * fail closed on generosity (a typo'd tier must never become unlimited).
 */
export function planEmailsLimit(tier: string | null | undefined): number | null {
  if (!tier || !(tier in PLAN_LIMITS)) return PLAN_LIMITS.free.emailsPerMonth;
  return PLAN_LIMITS[tier as PlanTier].emailsPerMonth;
}

export interface UsagePeriod {
  start: Date;
  end: Date;
}

export interface SubscriptionPeriodLike {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/**
 * The billing period containing `now`.
 * - With a subscription that carries period stamps: their cycle, advanced by
 *   whole months from the anchor until it contains now (cycle-preserving
 *   rollover — a subscription that hasn't billed yet keeps its day-of-month).
 * - Otherwise: the current UTC calendar month. Free/meterless orgs get a
 *   simple monthly bucket; there is nothing else honest to anchor to.
 */
export function currentUsagePeriod(
  now: Date = new Date(),
  subscription?: SubscriptionPeriodLike | null
): UsagePeriod {
  const s = subscription?.currentPeriodStart ?? null;
  const e = subscription?.currentPeriodEnd ?? null;
  if (s && e && s < e) {
    let start = new Date(s);
    let end = new Date(e);
    // Advance by whole calendar months from the anchor until now < end.
    // Guarded to 240 cycles (20 years) so a corrupt period can't hang ingest.
    for (let i = 0; i < 240 && now.getTime() >= end.getTime(); i++) {
      start = new Date(end);
      end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), end.getUTCHours(), end.getUTCMinutes(), end.getUTCSeconds(), end.getUTCMilliseconds()));
    }
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export const METRIC_EMAILS_SENT = "emails_sent" as const;
