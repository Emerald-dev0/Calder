/**
 * Usage metering + quota data layer (Phase 2 / M2.1).
 *
 * Model (ADR-036):
 * - `usage_records` is the per-email LEDGER: exactly one row per delivered-to-
 *   provider send, deterministic id `ur_<emailId>`, quantity 1. Exactly-once
 *   is enforced by the primary key combined with ON CONFLICT DO NOTHING, which
 *   makes retries, idempotent replays, and overlapping drains harmless.
 * - `usage_summaries` is the rolled-up projection per (org, metric, period),
 *   recomputed by the idempotent aggregation cron (deterministic id too).
 * - Quota at ingest is enforced against live `emails` rows accepted in the
 *   current period — not the ledger — so queued/in-flight mail also counts
 *   (you can't burst past the cap while mail is still landing).
 */

import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import {
  currentUsagePeriod,
  METRIC_EMAILS_SENT,
  planEmailsLimit,
  planFor,
  DAILY_BURST_PASS,
  type UsagePeriod,
} from "@calder/config";
import type { DbClient, DbExecutor } from "./client.js";
import { emails } from "./schema/emails.js";
import { plans } from "./schema/billing.js";
import { subscriptions } from "./schema/billing.js";
import { projects } from "./schema/projects.js";
import { usageRecords, usageSummaries } from "./schema/billing.js";
import { activeBurstCapacity, burstPassesToday, creditBalance } from "./credits.js";

/** Resolve an org's plan tier from its active subscription. Default: free. */
export async function resolveOrgTier(db: DbExecutor, organizationId: string): Promise<string> {
  const [row] = await db
    .select({ tier: plans.tier })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, "active"))
    )
    .limit(1);
  return row?.tier ?? "free";
}

/** The current usage period for an org (subscription cycle if stamped, else UTC month). */
export async function orgUsagePeriod(
  db: DbExecutor,
  organizationId: string,
  now: Date = new Date()
): Promise<UsagePeriod> {
  const [sub] = await db
    .select({
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return currentUsagePeriod(now, sub ?? null);
}

/**
 * Live sends accepted in `period` for the org — the quota view. Counts
 * emails rows joined through projects; excludes test-env traffic
 * (PRICING §5: test-key traffic is never metered).
 */
export async function orgAcceptedLiveInPeriod(
  db: DbExecutor,
  organizationId: string,
  period: UsagePeriod
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(emails)
    .innerJoin(projects, eq(emails.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(emails.env, "live"),
        gte(emails.createdAt, period.start),
        lt(emails.createdAt, period.end)
      )
    );
  return Number(row?.value ?? 0);
}

/** Calder's own transactional mail is never constrained by customer quotas. */
export const INTERNAL_ORGANIZATION_ID = "org_avenor";

export interface OrganizationQuotaDecision {
  allowed: boolean;
  tier: string;
  limit: number | null;
  usage: number;
  period: UsagePeriod;
  window?: "daily" | "billing_period";
  reason?: "test-env" | "internal-org" | "unlimited-tier";
  /** Monthly included allowance consumed for this request (not prepaid credits). */
  includedUsage?: number;
  /** Units above the included monthly allowance that prepaid credits must cover. */
  creditUnits?: number;
  /** Prepaid credit balance visible to this admission (locked org tx). */
  creditsAvailable?: number;
  /** Daily cap before burst passes. */
  dailyLimit?: number | null;
  /** Extra daily capacity from active passes for the current UTC day. */
  burstCapacity?: number;
  /** Daily cap including active burst passes. */
  dailyCapacity?: number | null;
  /** True when the daily refusal could be lifted by buying a burst pass. */
  passAvailable?: boolean;
}

/**
 * Shared quota decision used inside the organization send-admission
 * transaction. The caller holds the organization row lock while inserting,
 * so parallel projects/keys cannot race the same period ceiling.
 */
export async function checkOrganizationQuota(
  db: DbExecutor,
  organizationId: string,
  env: "test" | "live",
  incoming = 1,
  now: Date = new Date()
): Promise<OrganizationQuotaDecision> {
  const period = await orgUsagePeriod(db, organizationId, now);
  if (env === "test") {
    return { allowed: true, tier: "n/a", limit: null, usage: 0, period, reason: "test-env" };
  }
  if (organizationId === INTERNAL_ORGANIZATION_ID) {
    return {
      allowed: true,
      tier: "internal",
      limit: null,
      usage: 0,
      period,
      reason: "internal-org",
    };
  }
  const [tier, usage] = await Promise.all([
    resolveOrgTier(db, organizationId),
    orgAcceptedLiveInPeriod(db, organizationId, period),
  ]);
  const limit = planEmailsLimit(tier);
  // Prepaid credits cover only the overage above the included monthly
  // allowance. They never extend the daily ceiling (burst passes do that) and
  // the balance is read inside the caller's organization lock, so concurrent
  // admissions cannot promise the same credits twice.
  let creditUnits = 0;
  let creditsAvailable = 0;
  if (limit !== null && usage + incoming > limit) {
    const balance = await creditBalance(db, organizationId, now);
    creditsAvailable = balance.available;
    creditUnits = usage + incoming - limit;
    if (creditsAvailable < creditUnits) {
      return {
        allowed: false,
        tier,
        limit,
        usage,
        period,
        window: "billing_period",
        creditUnits,
        creditsAvailable,
        includedUsage: usage,
      };
    }
  }
  const dailyLimit = planFor(tier).dailySendCap;
  let dailyCapacity: number | null = dailyLimit;
  if (dailyLimit !== null) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dailyPeriod = { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
    const dailyUsage = await orgAcceptedLiveInPeriod(db, organizationId, dailyPeriod);
    const burstCapacity = await activeBurstCapacity(db, organizationId, now);
    dailyCapacity = dailyLimit + burstCapacity;
    if (dailyUsage + incoming > dailyCapacity) {
      const passesToday = await burstPassesToday(db, organizationId, now);
      return {
        allowed: false,
        tier,
        limit: dailyLimit,
        usage: dailyUsage,
        period: dailyPeriod,
        window: "daily",
        includedUsage: usage,
        creditUnits,
        creditsAvailable,
        dailyLimit,
        burstCapacity,
        dailyCapacity,
        passAvailable: passesToday < DAILY_BURST_PASS.maxPerUtcDay,
      };
    }
  }
  return {
    allowed: true,
    tier,
    limit,
    usage,
    period,
    window: "billing_period",
    includedUsage: usage,
    creditUnits,
    creditsAvailable,
    ...(dailyLimit !== null && dailyCapacity !== null
      ? { dailyLimit, burstCapacity: dailyCapacity - dailyLimit, dailyCapacity }
      : {}),
    ...(limit === null ? { reason: "unlimited-tier" as const } : {}),
  };
}

/**
 * Record one delivered send in the ledger. Returns true when a row was
 * written; false for test-env sends or when a ledger row already exists
 * (retry / replay / double-drain — all no-ops by design). The org is
 * resolved from the project so callers only need the send's own ids.
 */
export async function recordSendUsage(
  db: DbClient,
  opts: {
    emailId: string;
    projectId: string;
    env: string;
    when?: Date;
  }
): Promise<boolean> {
  if (opts.env !== "live") return false;
  const when = opts.when ?? new Date();
  const [proj] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, opts.projectId))
    .limit(1);
  if (!proj) return false;
  const organizationId = proj.organizationId;
  const period = await orgUsagePeriod(db, organizationId, when);
  const inserted = await db
    .insert(usageRecords)
    .values({
      id: `ur_${opts.emailId}`,
      organizationId,
      projectId: opts.projectId,
      metric: METRIC_EMAILS_SENT,
      quantity: 1,
      periodStart: period.start,
      periodEnd: period.end,
    })
    .onConflictDoNothing({ target: usageRecords.id })
    .returning({ id: usageRecords.id });
  return inserted.length > 0;
}

/**
 * Idempotent aggregation: recompute every org's current-period totals from
 * the ledger and upsert `usage_summaries`. Safe (and intended) to re-run:
 * PK-conflict upserts only refresh quantity + computedAt.
 */
export async function aggregateUsageNow(
  db: DbClient,
  now: Date = new Date()
): Promise<{ orgs: number; rows: number }> {
  const orgIds = (
    await db.selectDistinct({ organizationId: usageRecords.organizationId }).from(usageRecords)
  ).map((r) => r.organizationId);

  let rows = 0;
  for (const organizationId of orgIds) {
    const period = await orgUsagePeriod(db, organizationId, now);
    const [sum] = await db
      .select({ value: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)` })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.organizationId, organizationId),
          eq(usageRecords.metric, METRIC_EMAILS_SENT),
          eq(usageRecords.periodStart, period.start)
        )
      );
    const quantity = Number(sum?.value ?? 0);
    await db
      .insert(usageSummaries)
      .values({
        id: `ur_agg_${organizationId}_${METRIC_EMAILS_SENT}_${period.start.toISOString()}`,
        organizationId,
        metric: METRIC_EMAILS_SENT,
        periodStart: period.start,
        periodEnd: period.end,
        quantity,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: usageSummaries.id,
        set: { quantity, computedAt: now },
      });
    rows++;
  }
  return { orgs: orgIds.length, rows };
}

/** Usage page helper: tier, period, accepted live usage, and metered ledger total. */
export async function orgUsageSnapshot(
  db: DbClient,
  organizationId: string,
  now: Date = new Date()
) {
  const period = await orgUsagePeriod(db, organizationId, now);
  const dailyStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dailyPeriod = {
    start: dailyStart,
    end: new Date(dailyStart.getTime() + 24 * 60 * 60 * 1000),
  };
  const [tier, accepted, dailyAccepted, ledger, summary, credits, burstCapacity, passesToday] =
    await Promise.all([
      resolveOrgTier(db, organizationId),
      orgAcceptedLiveInPeriod(db, organizationId, period),
      orgAcceptedLiveInPeriod(db, organizationId, dailyPeriod),
      db
        .select({ value: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)` })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.organizationId, organizationId),
            eq(usageRecords.metric, METRIC_EMAILS_SENT),
            eq(usageRecords.periodStart, period.start)
          )
        )
        .then((r) => r[0]),
      db
        .select()
        .from(usageSummaries)
        .where(
          and(
            eq(usageSummaries.organizationId, organizationId),
            eq(usageSummaries.metric, METRIC_EMAILS_SENT),
            eq(usageSummaries.periodStart, period.start)
          )
        )
        .limit(1)
        .then((r) => r[0] ?? null),
      creditBalance(db, organizationId, now),
      activeBurstCapacity(db, organizationId, now),
      burstPassesToday(db, organizationId, now),
    ]);
  return {
    tier,
    period,
    acceptedLive: accepted,
    dailyAcceptedLive: dailyAccepted,
    dailyPeriod,
    dailyLimit: planFor(tier).dailySendCap,
    metered: Number(ledger?.value ?? 0),
    summaryQuantity: summary?.quantity ?? null,
    creditsAvailable: credits.available,
    creditsExpiringSoon: credits.expiringSoon,
    burstCapacityToday: burstCapacity,
    burstPassesToday: passesToday,
    burstPassLimit: DAILY_BURST_PASS.maxPerUtcDay,
    dailyCapacity:
      planFor(tier).dailySendCap === null
        ? null
        : (planFor(tier).dailySendCap ?? 0) + burstCapacity,
  };
}
