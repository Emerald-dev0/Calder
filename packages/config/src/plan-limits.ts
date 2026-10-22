/**
 * Plan catalogue — the single source of truth for what each Calder plan gives a
 * customer. Limits, prices and display names live here and nowhere else; the
 * dashboard, the API's quota errors, the marketing site and the database seed
 * all read from this file.
 *
 * Tier keys are the values the database stores (`plan_tier` enum), not the
 * marketing names: keeping `free` as a key means no data migration and no
 * alias table. The display names are what a human sees, and they are the only
 * names any surface is allowed to print.
 *
 * Two rule sets this file encodes:
 *
 *  1. **Enforced vs recorded.** Only projects, domains, sender identities and
 *     seats are enforced, and only at creation time — existing resources are
 *     grandfathered, never deleted or disabled. Retention, Gmail sender count
 *     and the Beginner daily cap are recorded here for the phases that will
 *     build them; nothing may read them to gate a request yet.
 *
 *  2. **No silent overages.** The monthly email allowance is a hard ceiling
 *     enforced by `@calder/db`'s quota check. Warning thresholds are ratios
 *     applied to the allowance, never per-plan hardcoded counts.
 *
 * Prices are stored in minor units (kobo, cents) so no float ever touches
 * money. ₦ and $ are independent price points, not conversions.
 */

export type PlanTier = "free" | "starter" | "pro" | "premium" | "scale";

/** Every tier except Scale resolves to a numeric ceiling. */
export type MeteredPlanTier = Exclude<PlanTier, "scale">;

export type Currency = "NGN" | "USD";

/** Minor units: kobo for NGN, cents for USD. `null` = custom/contract. */
export type PriceMinor = { NGN: number | null; USD: number | null };

export interface PlanLimit {
  /** The database value. Never rename without a migration. */
  tier: PlanTier;
  /** What a customer sees. The only name any surface may print. */
  displayName: string;
  price: PriceMinor;
  /** Monthly email allowance. `null` = custom/contract (no platform ceiling). */
  emailsPerMonth: number | null;
  projects: number | null;
  domains: number | null;
  senders: number | null;
  seats: number | null;
  /**
   * Recorded only — see UNENFORCED_PLAN_LIMITS. Nothing gates on these yet.
   */
  retentionDays: number | null;
  gmailSenders: number | null;
  dailySendCap: number | null;
  /**
   * Draft marketing contact allowance. **Not approved, not enforced, and not
   * rendered anywhere** — the Usage page must never show it. Kept only so the
   * decision is visible instead of lost.
   */
  contacts: { limit: number | null; approved: false };
}

/** Ordered from smallest to largest; used for upgrade pointers. */
export const PLAN_ORDER: readonly PlanTier[] = ["free", "starter", "pro", "premium", "scale"];

export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  free: {
    tier: "free",
    displayName: "Beginner",
    price: { NGN: 0, USD: 0 },
    emailsPerMonth: 5_000,
    projects: 3,
    domains: 2,
    senders: 5,
    seats: 1,
    retentionDays: 7,
    gmailSenders: 2,
    dailySendCap: 500,
    contacts: { limit: 1_000, approved: false },
  },
  starter: {
    tier: "starter",
    displayName: "Starter",
    price: { NGN: 500_000, USD: 500 },
    emailsPerMonth: 10_000,
    projects: 3,
    domains: 3,
    senders: 10,
    seats: 2,
    retentionDays: 14,
    gmailSenders: 2,
    dailySendCap: null,
    contacts: { limit: 10_000, approved: false },
  },
  pro: {
    tier: "pro",
    displayName: "Pro",
    price: { NGN: 2_000_000, USD: 1_800 },
    emailsPerMonth: 50_000,
    projects: 10,
    domains: 10,
    senders: 25,
    seats: 5,
    retentionDays: 30,
    gmailSenders: 2,
    dailySendCap: null,
    contacts: { limit: 50_000, approved: false },
  },
  premium: {
    tier: "premium",
    displayName: "Premium",
    price: { NGN: 7_500_000, USD: 6_500 },
    emailsPerMonth: 250_000,
    projects: 50,
    domains: 50,
    senders: 100,
    seats: 15,
    retentionDays: 90,
    gmailSenders: 2,
    dailySendCap: null,
    contacts: { limit: 50_000, approved: false },
  },
  scale: {
    tier: "scale",
    displayName: "Scale",
    price: { NGN: null, USD: null },
    emailsPerMonth: null,
    projects: null,
    domains: null,
    senders: null,
    seats: null,
    retentionDays: null,
    gmailSenders: null,
    dailySendCap: null,
    contacts: { limit: null, approved: false },
  },
};

/**
 * Recorded but deliberately not enforced in this phase. Anything that gates a
 * request must come from `LimitedResource` instead.
 */
export const UNENFORCED_PLAN_LIMITS = ["retentionDays", "gmailSenders", "dailySendCap"] as const;
export type UnenforcedPlanLimit = (typeof UNENFORCED_PLAN_LIMITS)[number];

/**
 * Resolve any tier string (including the `free` value older rows carry, and a
 * typo) to a catalogue entry. Unknown values fail closed to the smallest plan:
 * a bad tier must never become unlimited.
 */
export function planFor(tier: string | null | undefined): PlanLimit {
  if (tier && (PLAN_ORDER as readonly string[]).includes(tier)) {
    return PLAN_LIMITS[tier as PlanTier];
  }
  return PLAN_LIMITS.free;
}

/** The name to print for a tier. Never returns a raw database value. */
export function planDisplayName(tier: string | null | undefined): string {
  return planFor(tier).displayName;
}

/**
 * Emails/month ceiling for a tier. Unknown tiers resolve to the free floor:
 * fail closed on generosity (a typo'd tier must never become unlimited).
 */
export function planEmailsLimit(tier: string | null | undefined): number | null {
  return planFor(tier).emailsPerMonth;
}

/**
 * Warning points, as ratios of the monthly allowance. Computed, never stored:
 * 50% of 5,000 is 2,500 and 50% of 250,000 is 125,000 because the maths says
 * so, not because someone typed both numbers.
 */
export const USAGE_WARNING_RATIOS = [0.5, 0.8] as const;

/**
 * Absolute warning counts for a tier, ascending. Empty for unmetered tiers
 * (Scale) — there is no percentage of a custom ceiling.
 */
export function planWarningThresholds(tier: string | null | undefined): number[] {
  const limit = planEmailsLimit(tier);
  if (limit === null) return [];
  const values = USAGE_WARNING_RATIOS.map((r) => Math.round(limit * r));
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Format a price for display. `null` prints "Custom" — never "$0". */
export function formatPlanPrice(tier: string | null | undefined, currency: Currency): string {
  const minor = planFor(tier).price[currency];
  if (minor === null) return "Custom";
  const symbol = currency === "NGN" ? "₦" : "$";
  const major = minor / 100;
  // Whole numbers only: no plan price has cents, and "$18.00" reads like a bug.
  return `${symbol}${major.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/* ── Resource enforcement ─────────────────────────────────────────────────── */

/** The only limits enforced today, and only when a resource is created. */
export type LimitedResource = "projects" | "domains" | "senders" | "seats";

export const LIMITED_RESOURCES: readonly LimitedResource[] = [
  "projects",
  "domains",
  "senders",
  "seats",
];

const RESOURCE_FIELD: Record<LimitedResource, keyof PlanLimit> = {
  projects: "projects",
  domains: "domains",
  senders: "senders",
  seats: "seats",
};

const RESOURCE_NOUN: Record<LimitedResource, string> = {
  projects: "project",
  domains: "sending domain",
  senders: "sender identity",
  seats: "team seat",
};

/** Ceiling for one resource, or `null` when the plan has no ceiling. */
export function resourceLimit(tier: string | null | undefined, resource: LimitedResource) {
  const value = planFor(tier)[RESOURCE_FIELD[resource]];
  return typeof value === "number" ? value : null;
}

/**
 * The next plan that actually raises this resource's ceiling. Starter does not
 * lift Beginner's project limit (3 → 3), so the pointer skips it rather than
 * selling an upgrade that would not help.
 */
export function upgradeTierFor(
  tier: string | null | undefined,
  resource: LimitedResource
): PlanTier | null {
  const current = planFor(tier);
  const here = resourceLimit(current.tier, resource) ?? Number.POSITIVE_INFINITY;
  const start = PLAN_ORDER.indexOf(current.tier);
  for (const candidate of PLAN_ORDER.slice(start + 1)) {
    const limit = resourceLimit(candidate, resource);
    if (limit === null) return candidate; // custom/contract — always a way up
    if (limit > here) return candidate;
  }
  return null;
}

export interface ResourceLimitDecision {
  allowed: boolean;
  /** Stable code for the API and the UI to branch on. */
  code?: "plan_limit_reached";
  resource: LimitedResource;
  limit: number | null;
  used: number;
  tier: PlanTier;
  displayName: string;
  /** Human, actionable, and safe to show verbatim. */
  message?: string;
  upgradeTier?: PlanTier | null;
  upgradeDisplayName?: string | null;
}

/**
 * Decide whether one more resource may be created.
 *
 * Callers must only ask this on **creation**. Existing resources are
 * grandfathered: a workspace already over a limit keeps everything it has and
 * simply cannot add more until it is under the ceiling again.
 */
export function checkResourceLimit(
  tier: string | null | undefined,
  resource: LimitedResource,
  used: number
): ResourceLimitDecision {
  const plan = planFor(tier);
  const limit = resourceLimit(plan.tier, resource);

  if (limit === null) {
    return {
      allowed: true,
      resource,
      limit,
      used,
      tier: plan.tier,
      displayName: plan.displayName,
    };
  }

  if (used < limit) {
    return {
      allowed: true,
      resource,
      limit,
      used,
      tier: plan.tier,
      displayName: plan.displayName,
    };
  }

  const upgrade = upgradeTierFor(plan.tier, resource);
  const upgradeName = upgrade ? PLAN_LIMITS[upgrade].displayName : null;
  const noun = RESOURCE_NOUN[resource];
  const plural = limit === 1 ? noun : `${noun}s`;

  return {
    allowed: false,
    code: "plan_limit_reached",
    resource,
    limit,
    used,
    tier: plan.tier,
    displayName: plan.displayName,
    message: upgradeName
      ? `${plan.displayName} includes ${limit} ${plural} and this workspace already has ${used}. Upgrade to ${upgradeName} to add more.`
      : `${plan.displayName} includes ${limit} ${plural} and this workspace already has ${used}. Contact us for a plan with a higher ceiling.`,
    upgradeTier: upgrade,
    upgradeDisplayName: upgradeName,
  };
}

/* ── Usage period ─────────────────────────────────────────────────────────── */

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
      end = new Date(
        Date.UTC(
          end.getUTCFullYear(),
          end.getUTCMonth() + 1,
          end.getUTCDate(),
          end.getUTCHours(),
          end.getUTCMinutes(),
          end.getUTCSeconds(),
          end.getUTCMilliseconds()
        )
      );
    }
    return { start, end };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export const METRIC_EMAILS_SENT = "emails_sent" as const;
