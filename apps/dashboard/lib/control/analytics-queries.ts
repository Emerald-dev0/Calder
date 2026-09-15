/**
 * Analytics layer queries (DEC-004) — every number derived from real
 * analytics_events / waitlist_signups / emails rows. Zero rows → zero/empty;
 * nothing is ever invented (SRS REQ-083, NFR-004).
 */
import { and, count, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { analyticsEvents, emails, users, waitlistSignups } from "@calder/db";
import { getDb } from "@calder/db";
import type { DateWindow } from "./range.js";

async function scalar(promise: Promise<Array<{ value: unknown }>>): Promise<number> {
  const rows = await promise;
  return Number(rows[0]?.value ?? 0);
}

function evWhere(w: DateWindow) {
  const parts = [
    w.start ? gte(analyticsEvents.createdAt, w.start) : undefined,
    w.end && w.key !== "today" ? lt(analyticsEvents.createdAt, w.end) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? and(...parts) : undefined;
}

function wlWhere(w: DateWindow) {
  const parts = [
    w.start ? gte(waitlistSignups.createdAt, w.start) : undefined,
    w.end && w.key !== "today" ? lt(waitlistSignups.createdAt, w.end) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? and(...parts) : undefined;
}

/* ── Traffic (event layer) ─────────────────────────────────────────────── */

export interface TrafficTotals {
  visitors: number;
  sessions: number;
  pageviews: number;
  ctaClicks: number;
  /** visitors first seen in this window */
  newVisitors: number;
  returningVisitors: number;
  /** avg session duration in seconds from pageview spans; null if undefined */
  avgSessionSeconds: number | null;
  pagesPerSession: number | null;
  /** true when the event layer has any data in the window */
  hasData: boolean;
}

export async function trafficTotals(w: DateWindow): Promise<TrafficTotals> {
  const db = getDb();
  const cur = evWhere(w);
  const [totals, uniques, clickRow, newVisit] = await Promise.all([
    db
      .select({
        pageviews: count(),
        sessions: sql<number>`count(distinct ${analyticsEvents.sessionId})`,
      })
      .from(analyticsEvents)
      .where(cur),
    db
      .select({ value: sql<number>`count(distinct ${analyticsEvents.visitorId})` })
      .from(analyticsEvents)
      .where(cur),
    db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.type, "cta_click"), cur)),
    db
      .select({
        value: sql<number>`count(distinct ${analyticsEvents.visitorId})`,
      })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.type, "pageview"),
          cur,
          sql`not exists (
            select 1 from ${analyticsEvents} prior
            where prior.visitor_id = ${analyticsEvents.visitorId}
              and prior.created_at < ${w.start ?? new Date(0)}
          )`
        )
      ),
  ]);

  const pageviews = Number(totals[0]?.pageviews ?? 0);
  const sessions = Number(totals[0]?.sessions ?? 0);
  const visitors = Number(uniques[0]?.value ?? 0);
  const ctaClicks = Number(clickRow[0]?.value ?? 0);

  // Session duration from pageview spans within a session (max-min). Honest
  // "—" for single-page sessions; null when no session has ≥2 pageviews.
  let avgSessionSeconds: number | null = null;
  let pagesPerSession: number | null = null;
  if (pageviews > 0 && sessions > 0) {
    const spanRows = await db
      .select({
        sessionId: analyticsEvents.sessionId,
        span: sql<number>`extract(epoch from (max(${analyticsEvents.createdAt}) - min(${analyticsEvents.createdAt})))`,
        pages: count(),
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.type, "pageview"), cur))
      .groupBy(analyticsEvents.sessionId);
    const multi = spanRows.filter((r) => Number(r.pages) > 1);
    if (multi.length > 0) {
      const avgSpan = multi.reduce((acc, r) => acc + Number(r.span), 0) / multi.length;
      avgSessionSeconds = avgSpan;
    }
    pagesPerSession = pageviews / sessions;
  }

  return {
    visitors,
    sessions,
    pageviews,
    ctaClicks,
    newVisitors: Number(newVisit[0]?.value ?? 0),
    returningVisitors: Math.max(0, visitors - Number(newVisit[0]?.value ?? 0)),
    avgSessionSeconds,
    pagesPerSession,
    hasData: pageviews > 0 || ctaClicks > 0,
  };
}

/** Daily/weekly bucketed series for traffic + waitlist + conversion flows. */
export async function trafficDailySeries(
  w: DateWindow
): Promise<Array<{ day: string; visitors: number; sessions: number; clicks: number }>> {
  const db = getDb();
  const cur = evWhere(w);
  const rows = await db
    .select({
      day: sql<string>`to_char(${analyticsEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})`,
      sessions: sql<number>`count(distinct ${analyticsEvents.sessionId})`,
      clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'cta_click')`,
    })
    .from(analyticsEvents)
    .where(cur)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({
    day: r.day,
    visitors: Number(r.visitors),
    sessions: Number(r.sessions),
    clicks: Number(r.clicks),
  }));
}

/**
 * Daily conversions: waitlist emails that became Calder accounts (DEC-002),
 * bucketed by account-creation day. Derived live, never stored.
 */
export async function conversionsDaily(w: DateWindow): Promise<Array<{ day: string; count: number }>> {
  const db = getDb();
  const parts = [
    inArray(users.email, db.select({ email: waitlistSignups.email }).from(waitlistSignups)),
    w.start ? gte(users.createdAt, w.start) : undefined,
    w.end && w.key !== "today" ? lt(users.createdAt, w.end) : undefined,
  ].filter(Boolean);
  const rows = await db
    .select({
      day: sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(users)
    .where(and(...parts))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

/** Window conversions total (confirmed count for funnel/stat use). */
export async function conversionsInWindow(w: DateWindow): Promise<number> {
  const db = getDb();
  const parts = [
    inArray(users.email, db.select({ email: waitlistSignups.email }).from(waitlistSignups)),
    w.start ? gte(users.createdAt, w.start) : undefined,
    w.end && w.key !== "today" ? lt(users.createdAt, w.end) : undefined,
  ].filter(Boolean);
  return scalar(db.select({ value: count() }).from(users).where(and(...parts)));
}

/** Signups per source captured at signup time (window-aware). */
export async function waitlistSourceInWindow(
  w: DateWindow
): Promise<Array<{ source: string; submissions: number }>> {
  const db = getDb();
  const rows = await db
    .select({ source: waitlistSignups.source, value: count() })
    .from(waitlistSignups)
    .where(wlWhere(w))
    .groupBy(waitlistSignups.source)
    .orderBy(sql`count(*) desc`);
  return rows.map((r) => ({ source: r.source ?? "direct", submissions: Number(r.value) }));
}

export async function ctaBreakdown(
  w: DateWindow
): Promise<Array<{ label: string; clicks: number }>> {
  const db = getDb();
  const rows = await db
    .select({ label: analyticsEvents.label, value: count() })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.type, "cta_click"), evWhere(w)))
    .groupBy(analyticsEvents.label)
    .orderBy(sql`count(*) desc`);
  return rows
    .filter((r): r is { label: string; value: number } => r.label !== null)
    .map((r) => ({ label: r.label, clicks: Number(r.value) }));
}

export async function ctaImpressions(
  w: DateWindow,
  labels: string[]
): Promise<Map<string, number>> {
  const db = getDb();
  const pageByLabel: Record<string, string> = {
    join_waitlist: "/waitlist",
    view_pricing: "/pricing",
    read_docs: "/docs",
    developers: "/developers",
    sign_in: "/login",
  };
  const out = new Map<string, number>();
  for (const label of labels) {
    const path = pageByLabel[label];
    if (!path) continue;
    const rows = await db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.type, "pageview"), eq(analyticsEvents.path, path), evWhere(w)));
    out.set(label, Number(rows[0]?.value ?? 0));
  }
  return out;
}

export async function topPages(
  w: DateWindow,
  limit = 8
): Promise<Array<{ path: string; views: number; visitors: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      path: analyticsEvents.path,
      views: count(),
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})`,
    })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.type, "pageview"), evWhere(w)))
    .groupBy(analyticsEvents.path)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
  return rows
    .filter((r): r is { path: string; views: number; visitors: number } => r.path !== null)
    .map((r) => ({ path: r.path, views: Number(r.views), visitors: Number(r.visitors) }));
}

export async function sourceBreakdown(
  w: DateWindow
): Promise<Array<{ source: string; visitors: number; clicks: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      source: analyticsEvents.source,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})`,
      clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'cta_click')`,
    })
    .from(analyticsEvents)
    .where(evWhere(w))
    .groupBy(analyticsEvents.source)
    .orderBy(sql`count(distinct ${analyticsEvents.visitorId}) desc`);
  return rows.map((r) => ({
    source: r.source ?? "direct",
    visitors: Number(r.visitors),
    clicks: Number(r.clicks),
  }));
}

export async function countryBreakdown(
  w: DateWindow
): Promise<Array<{ country: string; visitors: number; clicks: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      country: analyticsEvents.country,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorId})`,
      clicks: sql<number>`count(*) filter (where ${analyticsEvents.type} = 'cta_click')`,
    })
    .from(analyticsEvents)
    .where(evWhere(w))
    .groupBy(analyticsEvents.country)
    .orderBy(sql`count(distinct ${analyticsEvents.visitorId}) desc`);
  return rows.map((r) => ({
    country: r.country ?? "Unknown",
    visitors: Number(r.visitors),
    clicks: Number(r.clicks),
  }));
}

/* ── Waitlist (real table, window-aware) ───────────────────────────────── */

export async function waitlistWindowCounts(
  w: DateWindow
): Promise<{ current: number; previous: number | null }> {
  const db = getDb();
  const current = w.start
    ? await scalar(
        db.select({ value: count() }).from(waitlistSignups).where(wlWhere(w))
      )
    : await scalar(db.select({ value: count() }).from(waitlistSignups));
  let previous: number | null = null;
  if (w.compareStart && w.compareEnd) {
    previous = await scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .where(
          and(gte(waitlistSignups.createdAt, w.compareStart), lt(waitlistSignups.createdAt, w.compareEnd))
        )
    );
  }
  return { current, previous };
}

export async function waitlistDailyInWindow(
  w: DateWindow
): Promise<Array<{ day: string; count: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      day: sql<string>`to_char(${waitlistSignups.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(waitlistSignups)
    .where(wlWhere(w))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

export async function waitlistCountryInWindow(
  w: DateWindow
): Promise<Array<{ country: string; submissions: number }>> {
  const db = getDb();
  const rows = await db
    .select({ country: waitlistSignups.country, value: count() })
    .from(waitlistSignups)
    .where(and(isNotNull(waitlistSignups.country), wlWhere(w)))
    .groupBy(waitlistSignups.country)
    .orderBy(sql`count(*) desc`);
  return rows.map((r) => ({ country: r.country as string, submissions: Number(r.value) }));
}

/* ── Confirmation email pipeline (proj_website) ────────────────────────── */

export interface ConfirmationTotals {
  sent: number;
  queued: number;
  accepted: number;
  delivered: number;
  failed: number;
  bounced: number;
  deliveryRate: number | null;
  hasData: boolean;
}

export async function confirmationTotals(w: DateWindow): Promise<ConfirmationTotals> {
  const db = getDb();
  const parts = [
    eq(emails.projectId, "proj_website"),
    w.start ? gte(emails.createdAt, w.start) : undefined,
    w.end && w.key !== "today" ? lt(emails.createdAt, w.end) : undefined,
  ].filter(Boolean);
  const where = and(...parts);
  const rows = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(where)
    .groupBy(emails.status);
  const s = (name: string) => Number(rows.find((r) => r.status === name)?.value ?? 0);
  const sent = s("sent");
  const delivered = s("delivered");
  const failed = s("failed");
  const bounced = s("bounced");
  const terminal = delivered + failed + bounced;
  return {
    sent,
    queued: s("queued") + s("sending") + s("created"),
    accepted: Math.max(0, sent - bounced),
    delivered,
    failed,
    bounced,
    deliveryRate: terminal > 0 ? (delivered / terminal) * 100 : null,
    hasData: sent + delivered + failed + bounced > 0,
  };
}

export async function recentConfirmationEvents(
  limit = 8
): Promise<Array<{ email: string; status: string; createdAt: Date; error: string | null }>> {
  const db = getDb();
  const rows = await db
    .select({
      email: emails.to,
      status: emails.status,
      createdAt: emails.createdAt,
      error: emails.lastError,
    })
    .from(emails)
    .where(eq(emails.projectId, "proj_website"))
    .orderBy(sql`${emails.createdAt} desc`)
    .limit(limit);
  return rows.map((r) => ({ ...r, error: r.error ?? null }));
}
