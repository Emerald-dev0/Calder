/**
 * Gmail abuse watch (Phase 2 / M2.5) + revocation marking (M2.4).
 *
 * PERSONAL-GMAIL-ONLY reality: a connected Gmail account is fine for dev and
 * small apps, catastrophic for bulk. Three graduated responses, all of them
 * audit-logged, none of them silent:
 *   warn    — velocity crosses the hourly warn line (visibility only)
 *   limit   — hard stop for this hour (transient: retry later, SES can fail over)
 *   suspend — sustained/egregious abuse: transport status → "suspended",
 *             sends refuse until a founder re-activates from control (appeal).
 * Revoked OAuth is ALSO terminal for the transport (`gmail_revoked` at send):
 * status → "revoked" once, audited once, the chain fails over to SES.
 *
 * The decision core is a PURE function — test the policy without a database.
 */

import { and, count, eq, gte, lt } from "drizzle-orm";
import type { DbClient } from "./client.js";
import { emails } from "./schema/emails.js";
import { projectTransports } from "./schema/transports.js";
import { auditLogs } from "./schema/system.js";

export interface GmailVelocitySnapshot {
  /** gmail-transported sends in the last 60 minutes. */
  lastHour: number;
  /** gmail-transported sends since 00:00 UTC today. */
  today: number;
  /** Prior 7 full days' daily average (excludes today). */
  dailyAvg7d: number;
}

export type GmailWatchVerdict =
  | { level: "ok" }
  | { level: "warn"; lastHour: number; storeEvent: boolean }
  | { level: "limit"; lastHour: number }
  | { level: "suspend"; lastHour: number; dailyAvg7d: number };

export interface GmailWatchThresholds {
  /** sends/hour at which the account is behaving like a bulk sender. */
  warnPerHour: number;
  /** sends/hour at which we stop sending until the window drains. */
  limitPerHour: number;
  /** sends/hour that immediately proves automation. */
  suspendPerHour: number;
  /** sustained-days rule: daily average at which Gmail is being outgrown. */
  graduateDailyAvg: number;
  /** provider daily cap, for the outgrown signal. */
  dailyCap: number;
}

export const DEFAULT_GMAIL_WATCH: GmailWatchThresholds = {
  // Google Workspace individual-account practical ceilings: ~2,000/day,
  // realistic safe-rate a few dozen/hour. Calder's default daily cap is
  // lower (GMAIL_FREE_DAILY_CAP = 400); hourly lines sit well under that.
  warnPerHour: Number(process.env.GMAIL_WATCH_WARN_PER_HOUR ?? 40),
  limitPerHour: Number(process.env.GMAIL_WATCH_LIMIT_PER_HOUR ?? 120),
  suspendPerHour: Number(process.env.GMAIL_WATCH_SUSPEND_PER_HOUR ?? 600),
  graduateDailyAvg: Number(process.env.GMAIL_WATCH_GRADUATE_DAILY ?? 100),
  dailyCap: Number(process.env.GMAIL_FREE_DAILY_CAP ?? 400),
};

/** The policy, as a table. Pure — every branch gets a unit test. */
export function assessGmailVelocity(
  snap: GmailVelocitySnapshot,
  t: GmailWatchThresholds = DEFAULT_GMAIL_WATCH
): GmailWatchVerdict {
  if (snap.lastHour >= t.suspendPerHour) {
    return { level: "suspend", lastHour: snap.lastHour, dailyAvg7d: snap.dailyAvg7d };
  }
  if (snap.lastHour >= t.limitPerHour) {
    return { level: "limit", lastHour: snap.lastHour };
  }
  // Sustained outgrowth: averaging above the graduation line with a cap that
  // has already been hit today means every hour is borrowed time. Suspend is
  // too hot for a paying customer; limit is right, warn informs the banner.
  if (snap.dailyAvg7d >= t.graduateDailyAvg && snap.today >= t.dailyCap) {
    return { level: "limit", lastHour: snap.lastHour };
  }
  if (snap.lastHour >= t.warnPerHour) {
    return { level: "warn", lastHour: snap.lastHour, storeEvent: true };
  }
  return { level: "ok" };
}

export async function gmailVelocitySnapshot(
  db: DbClient,
  projectId: string
): Promise<GmailVelocitySnapshot> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sevenDaysAgo = new Date(dayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const base = and(eq(emails.projectId, projectId), eq(emails.transport, "gmail"));
  const [hourRow, todayRow, weekRow] = await Promise.all([
    db.select({ value: count() }).from(emails).where(and(base, gte(emails.createdAt, hourAgo))),
    db.select({ value: count() }).from(emails).where(and(base, gte(emails.createdAt, dayStart))),
    db
      .select({ value: count() })
      .from(emails)
      .where(and(base, gte(emails.createdAt, sevenDaysAgo), lt(emails.createdAt, dayStart))),
  ]);
  return {
    lastHour: Number(hourRow[0]?.value ?? 0),
    today: Number(todayRow[0]?.value ?? 0),
    dailyAvg7d: Number(weekRow[0]?.value ?? 0) / 7,
  };
}

export class GmailWatchError extends Error {
  code: string;
  transient: boolean;
  statusCode: number;
  constructor(verdict: { level: "limit" | "suspend"; lastHour: number }) {
    super(
      verdict.level === "suspend"
        ? `Gmail transport suspended for abuse-pattern velocity (${verdict.lastHour} sends/hour). Gmail is an on-ramp, not infrastructure: verify a sending domain and connect SES (Dashboard → Domains) to resume production volume, or appeal from control.`
        : `Gmail hourly velocity limit reached (${verdict.lastHour} this hour). Retrying shortly; SES failover used when configured. Hitting this cap habitually? Verify your own sending domain (Dashboard → Domains) — production volume does not belong on Gmail.`
    );
    this.name = "GmailWatchError";
    this.code = verdict.level === "suspend" ? "gmail_suspended" : "gmail_velocity_limit";
    // suspend refails the row (permanent for this transport); limit is
    // transient so the queue's own backoff re-tries the SAME mail later and
    // a next leg can still fail over.
    this.transient = verdict.level === "limit";
    this.statusCode = verdict.level === "suspend" ? 403 : 429;
  }
}

async function auditOnce(
  db: DbClient,
  opts: {
    organizationId?: string | null;
    projectId: string;
    action: string;
    targetId: string;
    metadata: Record<string, unknown>;
    dedupeWithinHours?: number;
  }
): Promise<void> {
  // Dedupe: warns repeat at most once per 24h; suspends/revokes only once
  // per status transition (the transition itself IS the idempotency key).
  if (opts.dedupeWithinHours && opts.dedupeWithinHours > 0) {
    const since = new Date(Date.now() - opts.dedupeWithinHours * 3600_000);
    const seen = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, opts.action),
          eq(auditLogs.targetId, opts.targetId),
          gte(auditLogs.createdAt, since)
        )
      )
      .limit(1);
    if (seen.length > 0) return;
  }
  await db.insert(auditLogs).values({
    id: `alog_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    organizationId: opts.organizationId ?? null,
    projectId: opts.projectId,
    action: opts.action,
    targetType: "project_transport",
    targetId: opts.targetId,
    metadata: opts.metadata,
  });
}

/**
 * Enforce the velocity policy against the project's Gmail usage. Throws
 * GmailWatchError on limit/suspend; audits warns (debounced) and suspends
 * (with the status transition). Call BEFORE building the Gmail leg.
 */
export async function enforceGmailVelocity(
  db: DbClient,
  projectId: string,
  transport: { id: string; dailyCap: number | null }
): Promise<void> {
  const snap = await gmailVelocitySnapshot(db, projectId);
  const verdict = assessGmailVelocity(snap, {
    ...DEFAULT_GMAIL_WATCH,
    dailyCap: transport.dailyCap ?? DEFAULT_GMAIL_WATCH.dailyCap,
  });
  if (verdict.level === "ok") return;
  if (verdict.level === "warn") {
    await auditOnce(db, {
      projectId,
      action: "transport.gmail_velocity_warn",
      targetId: transport.id,
      metadata: { ...snap, thresholds: { warnPerHour: DEFAULT_GMAIL_WATCH.warnPerHour } },
      dedupeWithinHours: 24,
    });
    return;
  }
  if (verdict.level === "limit") {
    throw new GmailWatchError(verdict);
  }
  // suspend: flip status once (the UPDATE ... WHERE status = 'active' IS the
  // exactly-once switch), audit exactly on transition, then refuse.
  const suspended = await db
    .update(projectTransports)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(and(eq(projectTransports.id, transport.id), eq(projectTransports.status, "active")))
    .returning({ id: projectTransports.id });
  if (suspended.length > 0) {
    await auditOnce(db, {
      projectId,
      action: "transport.gmail_suspended",
      targetId: transport.id,
      metadata: { ...snap, reason: "gmail_velocity" },
    });
  }
  throw new GmailWatchError(verdict);
}

/**
 * M2.4: the provider said `gmail_revoked` (refresh token dead). Flip the
 * transport to `revoked` exactly once, audit the transition, so every
 * subsequent chain skips this leg instead of re-failing mail forever.
 */
export async function markGmailRevoked(
  db: DbClient,
  transportId: string,
  projectId: string
): Promise<boolean> {
  const updated = await db
    .update(projectTransports)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(projectTransports.id, transportId), eq(projectTransports.status, "active")))
    .returning({ id: projectTransports.id });
  if (updated.length === 0) return false;
  await auditOnce(db, {
    projectId,
    action: "transport.gmail_revoked",
    targetId: transportId,
    metadata: { reason: "invalid_grant" },
  });
  return true;
}

/**
 * M2.4 graduation signal: should the dashboard nudge this project from Gmail
 * onto a real provider? True when the 7-day average clears the graduation
 * line OR the cap has been hit today.
 */
export async function gmailNeedsGraduation(
  db: DbClient,
  projectId: string,
  dailyCap: number | null
): Promise<{ needed: boolean; dailyAvg7d: number; today: number; cap: number }> {
  const cap = dailyCap ?? DEFAULT_GMAIL_WATCH.dailyCap;
  const snap = await gmailVelocitySnapshot(db, projectId);
  const needed =
    snap.dailyAvg7d >= DEFAULT_GMAIL_WATCH.graduateDailyAvg || snap.today >= cap;
  return { needed, dailyAvg7d: snap.dailyAvg7d, today: snap.today, cap };
}
