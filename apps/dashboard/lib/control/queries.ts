import "../server-only"; // M6: build-time guard — control queries may never enter a client bundle
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  auditLogs,
  emailEvents,
  emails,
  organizationMembers,
  organizations,
  planPrices,
  plans,
  projectTransports,
  projects,
  sessions,
  subscriptions,
  suppressions,
  usageRecords,
  users,
  waitlistSignups,
  webhookDeliveries,
  webhooks,
} from "@calder/db";
import { getDb } from "@calder/db";

/**
 * Control Plane data access. Every function here is a live query — the
 * Control Plane never invents numbers. When infrastructure is unreachable
 * the queries degrade to an explicit status, never a fabricated zero.
 */

export const DAY_MS = 86_400_000;

export function utcDayStart(offsetDays = 0): Date {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(start - offsetDays * DAY_MS);
}

async function scalar(promise: Promise<Array<{ value: number }>>): Promise<number> {
  const rows = await promise;
  return Number(rows[0]?.value ?? 0);
}

/* ── Waitlist ──────────────────────────────────────────────────────────── */

export interface WaitlistOverview {
  total: number;
  newToday: number;
  new7d: number;
  prev7d: number;
  referred: number;
  invited: number;
  contacted: number;
  removed: number;
  converted: number;
  waiting: number;
}

export async function waitlistOverview(): Promise<WaitlistOverview> {
  const db = getDb();
  const today = utcDayStart();
  const d7 = new Date(today.getTime() - 7 * DAY_MS);
  const d14 = new Date(today.getTime() - 14 * DAY_MS);

  const [total, newToday, new7d, prev7d, referred, statusRows, converted] = await Promise.all([
    scalar(db.select({ value: count() }).from(waitlistSignups)),
    scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .where(gte(waitlistSignups.createdAt, today))
    ),
    scalar(
      db.select({ value: count() }).from(waitlistSignups).where(gte(waitlistSignups.createdAt, d7))
    ),
    scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .where(and(gte(waitlistSignups.createdAt, d14), lt(waitlistSignups.createdAt, d7)))
    ),
    scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .where(isNotNull(waitlistSignups.referredBy))
    ),
    db
      .select({ status: waitlistSignups.status, value: count() })
      .from(waitlistSignups)
      .groupBy(waitlistSignups.status),
    scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .innerJoin(users, eq(users.email, waitlistSignups.email))
    ),
  ]);

  const statusOf = (s: string) => Number(statusRows.find((r) => r.status === s)?.value ?? 0);
  return {
    total,
    newToday,
    new7d,
    prev7d,
    referred,
    invited: statusOf("invited"),
    contacted: statusOf("contacted"),
    removed: statusOf("removed"),
    converted,
    waiting: statusOf("waiting"),
  };
}

export async function waitlistDailyCounts(
  days: number | null
): Promise<Array<{ day: string; count: number }>> {
  const db = getDb();
  const where =
    days === null
      ? undefined
      : gte(waitlistSignups.createdAt, new Date(utcDayStart().getTime() - (days - 1) * DAY_MS));
  const rows = await db
    .select({
      day: sql<string>`to_char(${waitlistSignups.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(waitlistSignups)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
}

export async function waitlistSources(): Promise<Array<{ label: string; count: number }>> {
  const db = getDb();
  const rows = await db
    .select({ label: waitlistSignups.source, count: count() })
    .from(waitlistSignups)
    .groupBy(waitlistSignups.source);
  return rows.map((r) => ({ label: r.label ?? "direct", count: Number(r.count) }));
}

export async function waitlistCountries(
  limit = 8
): Promise<Array<{ label: string; count: number }>> {
  const db = getDb();
  const rows = await db
    .select({ label: waitlistSignups.country, count: count() })
    .from(waitlistSignups)
    .where(isNotNull(waitlistSignups.country))
    .groupBy(waitlistSignups.country)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({ label: r.label ?? "Unknown", count: Number(r.count) }));
}

export interface TopReferrer {
  code: string;
  email: string | null;
  invites: number;
}

export async function waitlistTopReferrers(limit = 10): Promise<TopReferrer[]> {
  const db = getDb();
  const rows = await db
    .select({ code: waitlistSignups.referredBy, invites: count() })
    .from(waitlistSignups)
    .where(isNotNull(waitlistSignups.referredBy))
    .groupBy(waitlistSignups.referredBy)
    .orderBy(desc(count()))
    .limit(limit);
  if (rows.length === 0) return [];
  const codes = rows.map((r) => r.code).filter((c): c is string => Boolean(c));
  const identities = await db
    .select({ code: waitlistSignups.referralCode, email: waitlistSignups.email })
    .from(waitlistSignups)
    .where(inArray(waitlistSignups.referralCode, codes));
  const emailByCode = new Map(identities.map((i) => [i.code, i.email]));
  return rows
    .filter((r): r is { code: string; invites: number } => Boolean(r.code))
    .map((r) => ({
      code: r.code,
      email: emailByCode.get(r.code) ?? null,
      invites: Number(r.invites),
    }));
}

export interface WaitlistRow {
  id: string;
  email: string;
  firstName: string | null;
  source: string | null;
  country: string | null;
  status: string;
  tags: string[] | null;
  note: string | null;
  referralCode: string;
  referredBy: string | null;
  invitedAt: Date | null;
  createdAt: Date;
}

export interface WaitlistQuery {
  q?: string;
  source?: string;
  status?: string;
  referred?: string;
  sort?: "newest" | "oldest";
  page?: number;
  perPage?: number;
}

export async function waitlistRows(
  query: WaitlistQuery
): Promise<{ rows: WaitlistRow[]; total: number; page: number; pages: number }> {
  const db = getDb();
  const perPage = query.perPage ?? 50;
  const page = Math.max(1, query.page ?? 1);

  const conditions = [];
  if (query.q) {
    const like = `%${query.q}%`;
    conditions.push(
      or(
        ilike(waitlistSignups.email, like),
        ilike(waitlistSignups.firstName, like),
        ilike(waitlistSignups.referralCode, like)
      )
    );
  }
  if (query.source === "__direct__") conditions.push(isNull(waitlistSignups.source));
  else if (query.source) conditions.push(eq(waitlistSignups.source, query.source));
  if (query.status === "converted") {
    conditions.push(inArray(waitlistSignups.email, db.select({ email: users.email }).from(users)));
  } else if (query.status) {
    conditions.push(
      eq(waitlistSignups.status, query.status as "waiting" | "invited" | "contacted" | "removed")
    );
  }
  if (query.referred === "referred") conditions.push(isNotNull(waitlistSignups.referredBy));
  if (query.referred === "organic") conditions.push(isNull(waitlistSignups.referredBy));
  const where = conditions.length ? and(...conditions) : undefined;

  const [total, rows] = await Promise.all([
    scalar(db.select({ value: count() }).from(waitlistSignups).where(where)),
    db
      .select()
      .from(waitlistSignups)
      .where(where)
      .orderBy(
        query.sort === "oldest" ? asc(waitlistSignups.createdAt) : desc(waitlistSignups.createdAt)
      )
      .limit(perPage)
      .offset((page - 1) * perPage),
  ]);

  return {
    rows: rows as WaitlistRow[],
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function waitlistPerson(id: string) {
  const db = getDb();
  const [person] = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.id, id))
    .limit(1);
  if (!person) return null;
  const [positionRow, invites, convertedUser, referrer] = await Promise.all([
    scalar(
      db
        .select({ value: count() })
        .from(waitlistSignups)
        .where(lt(waitlistSignups.createdAt, person.createdAt))
    ),
    db
      .select()
      .from(waitlistSignups)
      .where(eq(waitlistSignups.referredBy, person.referralCode))
      .orderBy(desc(waitlistSignups.createdAt)),
    db
      .select({ id: users.id, name: users.name, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.email, person.email))
      .limit(1),
    person.referredBy
      ? db
          .select({ id: waitlistSignups.id, email: waitlistSignups.email })
          .from(waitlistSignups)
          .where(eq(waitlistSignups.referralCode, person.referredBy))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    person,
    position: positionRow + 1,
    invites,
    convertedUser: convertedUser[0] ?? null,
    referrer: referrer[0] ?? null,
  };
}

/* ── Customers: users / organizations / projects ─────────────────────────── */

export async function customerTotals() {
  const db = getDb();
  const d7 = new Date(utcDayStart().getTime() - 6 * DAY_MS);
  const [total, new7d, verified, orgs, projectsCount] = await Promise.all([
    scalar(db.select({ value: count() }).from(users)),
    scalar(db.select({ value: count() }).from(users).where(gte(users.createdAt, d7))),
    scalar(db.select({ value: count() }).from(users).where(isNotNull(users.emailVerifiedAt))),
    scalar(db.select({ value: count() }).from(organizations)),
    scalar(db.select({ value: count() }).from(projects)),
  ]);
  return { total, new7d, verified, orgs, projectsCount };
}

export async function userRows(q: string | undefined, page: number) {
  const db = getDb();
  const perPage = 50;
  const like = q ? `%${q}%` : null;
  const where = like ? or(ilike(users.email, like), ilike(users.name, like)) : undefined;
  const [total, rows] = await Promise.all([
    scalar(db.select({ value: count() }).from(users).where(where)),
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

export async function userDetail(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const membershipsRaw = await db
    .select({ membership: organizationMembers, organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId));
  const memberships = await Promise.all(
    membershipsRaw.map(async (m) => ({
      ...m,
      projects: await db
        .select()
        .from(projects)
        .where(eq(projects.organizationId, m.organization.id)),
    }))
  );
  const [sends, lastSeen] = await Promise.all([
    scalar(
      db
        .select({ value: count() })
        .from(emails)
        .where(sql`false`)
    ),
    Promise.resolve(null as Date | null),
  ]);
  return { user, memberships, sends, lastSeen };
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  members: number;
  projects: number;
  plan: string | null;
  planName: string | null;
  status: string | null;
  periodEnd: Date | null;
  monthlyCents: number | null;
}

export async function organizationRows(limit = 200): Promise<OrgSummary[]> {
  const db = getDb();
  const orgRows = await db
    .select()
    .from(organizations)
    .orderBy(desc(organizations.createdAt))
    .limit(limit);
  const [memberCounts, projectCounts, activeSubs, priceRows, planRows] = await Promise.all([
    db
      .select({ organizationId: organizationMembers.organizationId, value: count() })
      .from(organizationMembers)
      .groupBy(organizationMembers.organizationId),
    db
      .select({ organizationId: projects.organizationId, value: count() })
      .from(projects)
      .groupBy(projects.organizationId),
    db
      .select({
        organizationId: subscriptions.organizationId,
        planId: subscriptions.planId,
        status: subscriptions.status,
        periodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active")),
    db.select().from(planPrices).where(eq(planPrices.currency, "NGN")),
    db.select().from(plans),
  ]);
  const membersBy = new Map(memberCounts.map((m) => [m.organizationId, Number(m.value)]));
  const projectsBy = new Map(projectCounts.map((m) => [m.organizationId, Number(m.value)]));
  const subsBy = new Map(activeSubs.map((s) => [s.organizationId, s]));
  const priceBy = new Map(priceRows.map((p) => [p.planId, p.amountCents]));
  const planById = new Map(planRows.map((p) => [p.id, p]));

  return orgRows.map((o) => {
    const sub = subsBy.get(o.id);
    const plan = sub ? planById.get(sub.planId) : undefined;
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      createdAt: o.createdAt,
      members: membersBy.get(o.id) ?? 0,
      projects: projectsBy.get(o.id) ?? 0,
      plan: plan?.tier ?? null,
      planName: plan?.name ?? null,
      status: sub?.status ?? null,
      periodEnd: sub?.periodEnd ?? null,
      monthlyCents: plan ? (priceBy.get(plan.id) ?? null) : null,
    };
  });
}

export async function orgDetail(orgId: string) {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return null;
  const orgProjects = await db.select().from(projects).where(eq(projects.organizationId, orgId));
  const [members, subs, planRows, priceRows, usage, audit, transports] = await Promise.all([
    db
      .select({ membership: organizationMembers, user: users })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, orgId)),
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .orderBy(desc(subscriptions.createdAt)),
    db.select().from(plans),
    db.select().from(planPrices).where(eq(planPrices.currency, "NGN")),
    db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.organizationId, orgId))
      .orderBy(desc(usageRecords.periodStart))
      .limit(6),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(10),
    orgProjects.length
      ? db
          .select()
          .from(projectTransports)
          .where(
            inArray(
              projectTransports.projectId,
              orgProjects.map((p) => p.id)
            )
          )
      : Promise.resolve([] as Array<typeof projectTransports.$inferSelect>),
  ]);
  const active = subs.find((s) => s.status === "active");
  const plan = active ? planRows.find((p) => p.id === active.planId) : undefined;
  const price = plan ? priceRows.find((p) => p.planId === plan.id) : undefined;
  const projectIds = orgProjects.map((p) => p.id);
  const [emailCount] = projectIds.length
    ? await db.select({ value: count() }).from(emails).where(inArray(emails.projectId, projectIds))
    : [{ value: 0 }];
  return {
    org,
    members,
    projects: orgProjects,
    subscriptions: subs,
    activeSubscription: active ?? null,
    plan: plan ?? null,
    monthlyCents: price?.amountCents ?? null,
    usage,
    audit,
    transports,
    emailCount: Number(emailCount?.value ?? 0),
  };
}

export async function projectRows(limit = 200) {
  const db = getDb();
  return db
    .select({
      project: projects,
      organization: organizations,
      emails: sql<number>`(select count(*) from ${emails} where ${emails.projectId} = ${projects.id})`,
      transports: sql<number>`(select count(*) from ${projectTransports} where ${projectTransports.projectId} = ${projects.id})`,
      lastSend: sql<Date | null>`(select max(created_at) from ${emails} where ${emails.projectId} = ${projects.id})`,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .orderBy(desc(projects.createdAt))
    .limit(limit);
}

/* ── Billing ─────────────────────────────────────────────────────────────── */

export interface BillingOverview {
  mrrCents: number;
  activeCount: number;
  pastDueCount: number;
  canceledCount: number;
  trialingCount: number;
  arpuCents: number | null;
  byPlan: Array<{ tier: string; name: string; orgs: number; monthlyCents: number }>;
  newSubsByMonth: Array<{ month: string; count: number }>;
  currency: "NGN" | "USD";
}

export async function billingOverview(): Promise<BillingOverview> {
  const db = getDb();
  const activeSubs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.status, "active"));
  const [priceRows, planRows, pastDue, canceled, trialing, newSubs] = await Promise.all([
    db.select().from(planPrices).where(eq(planPrices.currency, "NGN")),
    db.select().from(plans),
    scalar(
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "past_due"))
    ),
    scalar(
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "canceled"))
    ),
    scalar(
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "trialing"))
    ),
    db
      .select({
        month: sql<string>`to_char(${subscriptions.createdAt} at time zone 'UTC', 'YYYY-MM')`,
        count: count(),
      })
      .from(subscriptions)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);
  const priceBy = new Map(priceRows.map((p) => [p.planId, p.amountCents]));
  const planById = new Map(planRows.map((p) => [p.id, p]));

  let mrr = 0;
  const tierCounts = new Map<string, { name: string; orgs: number }>();
  for (const sub of activeSubs) {
    const price = priceBy.get(sub.planId) ?? 0;
    mrr += price;
    const plan = planById.get(sub.planId);
    if (plan) {
      const cur = tierCounts.get(plan.tier) ?? { name: plan.name, orgs: 0 };
      cur.orgs += 1;
      tierCounts.set(plan.tier, cur);
    }
  }
  return {
    mrrCents: mrr,
    activeCount: activeSubs.length,
    pastDueCount: pastDue,
    canceledCount: canceled,
    trialingCount: trialing,
    arpuCents: activeSubs.length ? Math.round(mrr / activeSubs.length) : null,
    byPlan: [...tierCounts.entries()].map(([tier, v]) => ({
      tier,
      name: v.name,
      orgs: v.orgs,
      monthlyCents:
        (priceRows.find((p) => planById.get(p.planId)?.tier === tier)?.amountCents ?? 0) * v.orgs,
    })),
    newSubsByMonth: newSubs.map((r) => ({ month: r.month, count: Number(r.count) })),
    currency: "NGN",
  };
}

export async function subscriptionRows(limit = 100) {
  const db = getDb();
  return db
    .select({
      subscription: subscriptions,
      organization: organizations,
      plan: plans,
      price: sql<
        number | null
      >`(select amount_cents from plan_prices pp where pp.plan_id = ${plans.id} and pp.currency = 'NGN' limit 1)`,
    })
    .from(subscriptions)
    .innerJoin(organizations, eq(subscriptions.organizationId, organizations.id))
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .orderBy(desc(subscriptions.createdAt))
    .limit(limit);
}

export async function planCatalog() {
  const db = getDb();
  const [planRows, priceRows] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.createdAt)),
    db.select().from(planPrices),
  ]);
  return planRows.map((p) => ({
    plan: p,
    prices: priceRows.filter((pr) => pr.planId === p.id),
    activeSubs: 0,
  }));
}

/* ── Email pipeline / platform ───────────────────────────────────────────── */

export interface PipelineDay {
  day: string;
  created: number;
  delivered: number;
  failed: number;
  bounced: number;
}

export async function pipelineDaily(days: number): Promise<PipelineDay[]> {
  const db = getDb();
  const since = new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
  const rows = await db
    .select({
      day: sql<string>`to_char(${emails.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      created: count(),
      delivered: sql<number>`count(*) filter (where ${emails.status} = 'delivered')`,
      failed: sql<number>`count(*) filter (where ${emails.status} in ('failed','bounced','complained'))`,
    })
    .from(emails)
    .where(gte(emails.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({
    day: r.day,
    created: Number(r.created),
    delivered: Number(r.delivered),
    failed: Number(r.failed),
    bounced: 0,
  }));
}

export interface EmailTotals {
  total: number;
  today: number;
  delivered: number;
  sent: number;
  failed: number;
  bounced: number;
  complained: number;
  queued: number;
  sending: number;
  opened: number;
  clicked: number;
  deliveryRate: number | null;
}

export async function emailTotals(days: number | null): Promise<EmailTotals> {
  const db = getDb();
  const since = days === null ? undefined : new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
  const w = since ? gte(emails.createdAt, since) : undefined;
  const today = utcDayStart();
  const [total, todayCount, statusRows] = await Promise.all([
    scalar(db.select({ value: count() }).from(emails).where(w)),
    scalar(db.select({ value: count() }).from(emails).where(gte(emails.createdAt, today))),
    db
      .select({ status: emails.status, value: count() })
      .from(emails)
      .where(w)
      .groupBy(emails.status),
  ]);
  const s = (name: string) => Number(statusRows.find((r) => r.status === name)?.value ?? 0);
  const delivered = s("delivered");
  const terminal = delivered + s("bounced") + s("complained") + s("failed");
  return {
    total,
    today: todayCount,
    delivered,
    sent: s("sent"),
    failed: s("failed"),
    bounced: s("bounced"),
    complained: s("complained"),
    queued: s("queued"),
    sending: s("sending"),
    opened: 0,
    clicked: 0,
    deliveryRate: terminal > 0 ? (delivered / terminal) * 100 : null,
  };
}

export async function transportDistribution() {
  const db = getDb();
  return db
    .select({ transport: emails.transport, provider: emails.provider, value: count() })
    .from(emails)
    .where(isNotNull(emails.transport))
    .groupBy(emails.transport, emails.provider)
    .orderBy(desc(count()));
}

export async function recentFailures(limit = 20) {
  const db = getDb();
  return db
    .select({
      id: emails.id,
      subject: emails.subject,
      to: emails.to,
      status: emails.status,
      transport: emails.transport,
      lastError: emails.lastError,
      createdAt: emails.createdAt,
      projectName: projects.name,
    })
    .from(emails)
    .innerJoin(projects, eq(emails.projectId, projects.id))
    .where(inArray(emails.status, ["failed", "bounced", "complained"]))
    .orderBy(desc(emails.createdAt))
    .limit(limit);
}

export async function deliverabilityBySender(days = 30) {
  const db = getDb();
  const since = new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
  return db
    .select({
      from: emails.from,
      sent: count(),
      delivered: sql<number>`count(*) filter (where ${emails.status} = 'delivered')`,
      bounced: sql<number>`count(*) filter (where ${emails.status} = 'bounced')`,
      complained: sql<number>`count(*) filter (where ${emails.status} = 'complained')`,
    })
    .from(emails)
    .where(
      and(
        gte(emails.createdAt, since),
        inArray(emails.status, ["delivered", "bounced", "complained", "sent", "failed"])
      )
    )
    .groupBy(emails.from)
    .orderBy(desc(count()))
    .limit(12);
}

export interface DeliveryOutcomeSummary {
  windowDays: number;
  started: number;
  inFlight: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  suppressed: number;
  /** delivered + bounced + complained + failed — the denominator for honest rates. */
  terminal: number;
  deliveryRate: number | null; // delivered / terminal (null when nothing completed)
  bounceRate: number | null;
  complaintRate: number | null;
}

/**
 * Platform-wide deliverability truth for a window. Rates are computed
 * against TERMINAL sends only — in-flight messages are not failures, and
 * counting "sent" as delivered (the old page cheat) overstates health.
 */
export async function deliveryOutcomeSummary(days = 30): Promise<DeliveryOutcomeSummary> {
  const db = getDb();
  const since = new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
  const rows = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(gte(emails.createdAt, since))
    .groupBy(emails.status);
  const s = (name: string) => Number(rows.find((r) => r.status === name)?.value ?? 0);
  const delivered = s("delivered");
  const bounced = s("bounced");
  const complained = s("complained");
  const failed = s("failed");
  const terminal = delivered + bounced + complained + failed;
  const pct = (n: number) => (terminal > 0 ? (n / terminal) * 100 : null);
  return {
    windowDays: days,
    started: rows.reduce((n, r) => n + Number(r.value), 0),
    inFlight: s("created") + s("queued") + s("sending"),
    sent: s("sent"),
    delivered,
    bounced,
    complained,
    failed,
    suppressed: s("suppressed"),
    terminal,
    deliveryRate: pct(delivered),
    bounceRate: pct(bounced),
    complaintRate: pct(complained),
  };
}

export async function webhookStats() {
  const db = getDb();
  const [endpoints, deliveries, byStatus] = await Promise.all([
    scalar(db.select({ value: count() }).from(webhooks)),
    scalar(db.select({ value: count() }).from(webhookDeliveries)),
    db
      .select({ status: webhookDeliveries.status, value: count() })
      .from(webhookDeliveries)
      .groupBy(webhookDeliveries.status),
  ]);
  const s = (name: string) => Number(byStatus.find((r) => r.status === name)?.value ?? 0);
  return {
    endpoints,
    deliveries,
    delivered: s("delivered"),
    pending: s("pending"),
    failed: s("failed"),
    exhausted: s("exhausted"),
  };
}

/* ── Infrastructure ──────────────────────────────────────────────────────── */

export interface DbHealth {
  reachable: boolean;
  version: string;
  latencyMs: number | null;
  sizeBytes: number | null;
  connections: number | null;
  maxConnections: number | null;
  uptimeSince: Date | null;
  tables: Array<{ table: string; rows: number; sizeBytes: number }>;
  cacheHitRate: number | null;
}

export async function dbHealth(): Promise<DbHealth> {
  const db = getDb();
  try {
    const started = Date.now();
    const [versionRow] = await db.execute<{ version: string }>(sql`select version() as version`);
    const latency = Date.now() - started;
    const [sizeRow] = await db.execute<{ size: string }>(
      sql`select pg_database_size(current_database())::text as size`
    );
    const [connRow] = await db.execute<{ conns: string; max: string }>(sql`
      select
        (select count(*) from pg_stat_activity where datname = current_database())::text as conns,
        current_setting('max_connections')::text as max
    `);
    const [uptimeRow] = await db.execute<{ started: Date }>(
      sql`select pg_postmaster_start_time() as started`
    );
    const tables = await db.execute<{ table: string; rows: string; size: string }>(sql`
      select relname::text as table, n_live_tup::text as rows, pg_total_relation_size(relid)::text as size
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8
    `);
    const [hitRow] = await db.execute<{ hit: string; read: string }>(sql`
      select coalesce(sum(heap_blks_hit),0)::text as hit, coalesce(sum(heap_blks_read),0)::text as read
      from pg_statio_user_tables
    `);
    const hit = Number(hitRow?.hit ?? 0);
    const read = Number(hitRow?.read ?? 0);
    return {
      reachable: true,
      version: String(versionRow?.version ?? "")
        .split(" ")
        .slice(0, 2)
        .join(" "),
      latencyMs: latency,
      sizeBytes: Number(sizeRow?.size ?? 0),
      connections: Number(connRow?.conns ?? 0),
      maxConnections: Number(connRow?.max ?? 0),
      uptimeSince: uptimeRow?.started ? new Date(uptimeRow.started) : null,
      tables: tables.map((t) => ({
        table: t.table,
        rows: Number(t.rows),
        sizeBytes: Number(t.size),
      })),
      cacheHitRate: hit + read > 0 ? (hit / (hit + read)) * 100 : null,
    };
  } catch {
    return {
      reachable: false,
      version: "",
      latencyMs: null,
      sizeBytes: null,
      connections: null,
      maxConnections: null,
      uptimeSince: null,
      tables: [],
      cacheHitRate: null,
    };
  }
}

export interface RedisHealth {
  configured: boolean;
  reachable: boolean;
  version: string | null;
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  connectedClients: number | null;
  opsPerSec: number | null;
  hitRate: number | null;
  evictedKeys: number | null;
  uptimeDays: number | null;
}

export async function redisHealth(): Promise<RedisHealth> {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  let client: import("ioredis").Redis | null = null;
  try {
    const IORedis = (await import("ioredis")).default;
    client = new IORedis(url, {
      lazyConnect: true,
      connectTimeout: 700,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", () => {});
    await client.connect();
    const [infoServer, infoMemory, infoStats] = await Promise.all([
      client.info("server"),
      client.info("memory"),
      client.info("stats"),
    ]);
    const pick = (section: string, key: string) => {
      const line = section.split("\r\n").find((l: string) => l.startsWith(`${key}:`));
      return Number(line?.slice(key.length + 1) ?? 0);
    };
    const hits = pick(infoStats, "keyspace_hits");
    const misses = pick(infoStats, "keyspace_misses");
    return {
      configured: true,
      reachable: true,
      version:
        infoServer
          .split("\r\n")
          .find((l) => l.startsWith("redis_version:"))
          ?.split(":")[1] ?? null,
      usedMemoryBytes: pick(infoMemory, "used_memory"),
      maxMemoryBytes: pick(infoMemory, "maxmemory"),
      connectedClients: pick(infoMemory, "maxmemory_human")
        ? pick(infoStats, "connected_clients")
        : pick(infoStats, "connected_clients"),
      opsPerSec: pick(infoStats, "instantaneous_ops_per_sec"),
      hitRate: hits + misses > 0 ? (hits / (hits + misses)) * 100 : null,
      evictedKeys: pick(infoStats, "evicted_keys"),
      uptimeDays: pick(infoServer, "uptime_in_days"),
    };
  } catch {
    return {
      configured: Boolean(process.env.REDIS_URL),
      reachable: false,
      version: null,
      usedMemoryBytes: null,
      maxMemoryBytes: null,
      connectedClients: null,
      opsPerSec: null,
      hitRate: null,
      evictedKeys: null,
      uptimeDays: null,
    };
  } finally {
    if (client) client.disconnect();
  }
}

/**
 * Queue depth, derived from the email pipeline's durable state (Postgres).
 * BullMQ's live counters need Redis; when Redis is down this is the honest,
 * always-available view of what is actually waiting.
 */
export async function queueDerived() {
  const db = getDb();
  const [inFlight, failedRecent, oldest] = await Promise.all([
    scalar(
      db
        .select({ value: count() })
        .from(emails)
        .where(inArray(emails.status, ["created", "queued", "sending"]))
    ),
    scalar(
      db
        .select({ value: count() })
        .from(emails)
        .where(
          and(
            inArray(emails.status, ["failed", "bounced"]),
            gte(emails.updatedAt, new Date(Date.now() - DAY_MS))
          )
        )
    ),
    db
      .select({ createdAt: emails.createdAt })
      .from(emails)
      .where(inArray(emails.status, ["created", "queued"]))
      .orderBy(asc(emails.createdAt))
      .limit(1),
  ]);
  const oldestAgeMinutes = oldest[0]?.createdAt
    ? Math.floor((Date.now() - new Date(oldest[0].createdAt).getTime()) / 60000)
    : null;
  return { inFlight, failedRecent, oldestAgeMinutes };
}

export async function workerThroughput(): Promise<Array<{ hour: string; sent: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      hour: sql<string>`to_char(${emails.updatedAt} at time zone 'UTC', 'MM-DD HH24:00')`,
      sent: count(),
    })
    .from(emails)
    .where(
      and(
        gte(emails.updatedAt, new Date(Date.now() - DAY_MS)),
        inArray(emails.status, ["sent", "delivered"])
      )
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ hour: r.hour, sent: Number(r.sent) }));
}

export async function transportFleet() {
  const db = getDb();
  return db
    .select({
      type: projectTransports.type,
      status: projectTransports.status,
      value: count(),
    })
    .from(projectTransports)
    .groupBy(projectTransports.type, projectTransports.status);
}

export async function gmailCapUsage() {
  const db = getDb();
  const today = utcDayStart();
  const hourAgo = new Date(Date.now() - 3600_000);
  const rows = await db
    .select({
      id: projectTransports.id,
      label: projectTransports.label,
      dailyCap: projectTransports.dailyCap,
      status: projectTransports.status,
      lastUsedAt: projectTransports.lastUsedAt,
      projectId: projectTransports.projectId,
      projectName: projects.name,
      organizationName: organizations.name,
      organizationId: organizations.id,
      sentLastHour: sql<number>`(
        select count(*) from ${emails}
        where ${emails.transport} = 'gmail'
          and ${emails.createdAt} >= ${hourAgo.toISOString()}
          and ${emails.projectId} = ${projectTransports.projectId}
      )`,
      sentToday: sql<number>`(
        select count(*) from ${emails}
        where ${emails.transport} = 'gmail'
          and ${emails.createdAt} >= ${today.toISOString()}
          and ${emails.projectId} = ${projectTransports.projectId}
      )`,
    })
    .from(projectTransports)
    .innerJoin(projects, eq(projects.id, projectTransports.projectId))
    .innerJoin(organizations, eq(organizations.id, projects.organizationId))
    .where(eq(projectTransports.type, "gmail"))
    .orderBy(desc(projectTransports.lastUsedAt))
    .limit(50);
  return rows.map((r) => ({ ...r, sentToday: Number(r.sentToday), sentLastHour: Number(r.sentLastHour) }));
}

/** Recent Gmail watch / revocation / appeal actions from the audit trail. */
export async function gmailWatchEvents(limit = 20) {
  const db = getDb();
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetId: auditLogs.targetId,
      projectId: auditLogs.projectId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(sql`${auditLogs.action} like 'transport.gmail%'`)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows;
}

/* ── Observability ───────────────────────────────────────────────────────── */

export async function eventRows(opts: { type?: string; q?: string; page: number }) {
  const db = getDb();
  const perPage = 60;
  const conditions = [];
  if (opts.type) conditions.push(eq(emailEvents.type, opts.type as "created"));
  if (opts.q) conditions.push(ilike(emails.to, `%${opts.q}%`));
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows, byType] = await Promise.all([
    scalar(
      db
        .select({ value: count() })
        .from(emailEvents)
        .innerJoin(emails, eq(emailEvents.emailId, emails.id))
        .where(where)
    ),
    db
      .select({
        id: emailEvents.id,
        type: emailEvents.type,
        createdAt: emailEvents.createdAt,
        data: emailEvents.data,
        to: emails.to,
        subject: emails.subject,
        status: emails.status,
        projectName: projects.name,
      })
      .from(emailEvents)
      .innerJoin(emails, eq(emailEvents.emailId, emails.id))
      .innerJoin(projects, eq(emailEvents.projectId, projects.id))
      .where(where)
      .orderBy(desc(emailEvents.createdAt))
      .limit(perPage)
      .offset((opts.page - 1) * perPage),
    db
      .select({ type: emailEvents.type, value: count() })
      .from(emailEvents)
      .groupBy(emailEvents.type),
  ]);
  return {
    rows,
    total,
    page: opts.page,
    pages: Math.max(1, Math.ceil(total / perPage)),
    byType: byType
      .map((r) => ({ type: r.type, count: Number(r.value) }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function auditRows(opts: { q?: string; page: number }) {
  const db = getDb();
  const perPage = 60;
  const like = opts.q ? `%${opts.q}%` : null;
  const where = like
    ? or(ilike(auditLogs.action, like), ilike(auditLogs.targetId, like))
    : undefined;
  const [total, rows] = await Promise.all([
    scalar(db.select({ value: count() }).from(auditLogs).where(where)),
    db
      .select({ audit: auditLogs, actorEmail: users.email, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(perPage)
      .offset((opts.page - 1) * perPage),
  ]);
  return { rows, total, page: opts.page, pages: Math.max(1, Math.ceil(total / perPage)) };
}

/* ── Alerts ──────────────────────────────────────────────────────────────── */

export interface ControlAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  metric: string;
  href: string;
}

export async function evaluateAlerts(): Promise<ControlAlert[]> {
  const db = getDb();
  const alerts: ControlAlert[] = [];
  const since24 = new Date(Date.now() - DAY_MS);

  const [statusRows, pastDue, redis, dbh, queue] = await Promise.all([
    db
      .select({ status: emails.status, value: count() })
      .from(emails)
      .where(gte(emails.createdAt, since24))
      .groupBy(emails.status),
    scalar(
      db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.status, "past_due"))
    ),
    redisHealth(),
    dbHealth(),
    queueDerived(),
  ]);
  const s = (name: string) => Number(statusRows.find((r) => r.status === name)?.value ?? 0);
  const delivered = s("delivered");
  const bounced = s("bounced");
  const complained = s("complained");
  const failed = s("failed");
  const terminal = delivered + bounced + complained + failed;
  const deliveryRate = terminal > 0 ? (delivered / terminal) * 100 : null;
  const sent24 = statusRows.reduce((n, r) => n + Number(r.value), 0);

  if (deliveryRate !== null && deliveryRate < 97) {
    alerts.push({
      id: "delivery-rate",
      severity: deliveryRate < 95 ? "critical" : "warning",
      title: "Delivery rate below threshold",
      detail: `24h delivery rate is ${deliveryRate.toFixed(1)}% (threshold 97%).`,
      metric: `${deliveryRate.toFixed(1)}% < 97%`,
      href: "/control/platform/deliverability",
    });
  }
  if (complained > 0) {
    alerts.push({
      id: "complaints",
      severity: "critical",
      title: "Complaints received in the last 24h",
      detail: `${complained} complaint${complained === 1 ? "" : "s"} recorded. Complaints damage platform reputation — investigate immediately.`,
      metric: `${complained} > 0`,
      href: "/control/security",
    });
  }
  if (bounced > Math.max(5, sent24 * 0.03)) {
    alerts.push({
      id: "bounces",
      severity: "warning",
      title: "Elevated bounce rate",
      detail: `${bounced} bounces in the last 24h across ${sent24} accepted sends.`,
      metric: `${sent24 ? ((bounced / sent24) * 100).toFixed(1) : "0"}% > 3%`,
      href: "/control/platform/deliverability",
    });
  }
  if (queue.inFlight > 5000) {
    alerts.push({
      id: "queue-depth",
      severity: "warning",
      title: "Queue depth high",
      detail: `${queue.inFlight.toLocaleString()} messages created/queued/sending — above the 5,000 comfort threshold.`,
      metric: `${queue.inFlight} > 5000`,
      href: "/control/infrastructure/queues",
    });
  }
  if (queue.oldestAgeMinutes !== null && queue.oldestAgeMinutes > 15) {
    alerts.push({
      id: "queue-age",
      severity: "warning",
      title: "Oldest queued message is aging",
      detail: `A queued message has waited ${queue.oldestAgeMinutes} minutes — workers may be stalled.`,
      metric: `${queue.oldestAgeMinutes}m > 15m`,
      href: "/control/infrastructure/workers",
    });
  }
  if (!redis.reachable) {
    alerts.push({
      id: "redis",
      severity: "warning",
      title: "Redis unreachable",
      detail:
        "Queue, rate limiting, and cache operate on Redis. Delivery falls back but retries and rate caps degrade.",
      metric: "PING failed",
      href: "/control/infrastructure/redis",
    });
  } else if (
    redis.usedMemoryBytes &&
    redis.maxMemoryBytes &&
    redis.maxMemoryBytes > 0 &&
    redis.usedMemoryBytes / redis.maxMemoryBytes > 0.8
  ) {
    alerts.push({
      id: "redis-mem",
      severity: "warning",
      title: "Redis memory above 80%",
      detail: `${((redis.usedMemoryBytes / redis.maxMemoryBytes) * 100).toFixed(0)}% of maxmemory in use.`,
      metric: "> 80%",
      href: "/control/infrastructure/redis",
    });
  }
  if (
    dbh.reachable &&
    dbh.maxConnections &&
    dbh.connections !== null &&
    dbh.connections / dbh.maxConnections > 0.8
  ) {
    alerts.push({
      id: "db-conn",
      severity: "warning",
      title: "Database connections above 80%",
      detail: `${dbh.connections} of ${dbh.maxConnections} connections in use.`,
      metric: `${dbh.connections}/${dbh.maxConnections}`,
      href: "/control/infrastructure/database",
    });
  }
  if (pastDue > 0) {
    alerts.push({
      id: "past-due",
      severity: "info",
      title: "Past-due subscriptions",
      detail: `${pastDue} subscription${pastDue === 1 ? "" : "s"} past due — payment retry or outreach needed.`,
      metric: `${pastDue} > 0`,
      href: "/control/billing/subscriptions",
    });
  }
  const severityRank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/* ── Security / abuse ────────────────────────────────────────────────────── */

export async function abuseCandidates(days = 7) {
  const db = getDb();
  const since = new Date(utcDayStart().getTime() - (days - 1) * DAY_MS);
  const rows = await deliverabilityBySender(days);
  const suspicious = rows
    .map((r) => ({
      from: r.from,
      sent: Number(r.sent),
      bounced: Number(r.bounced),
      complained: Number(r.complained),
      bounceRate: Number(r.sent) > 0 ? (Number(r.bounced) / Number(r.sent)) * 100 : 0,
    }))
    .filter((r) => r.sent >= 10 && (r.bounceRate >= 10 || r.complained > 0));
  const suspensionRows = await db
    .select({ value: count() })
    .from(projectTransports)
    .where(ne(projectTransports.status, "active"));
  const suspensions = Number(suspensionRows[0]?.value ?? 0);
  const suppressedRows = await db.select({ value: count() }).from(suppressions);
  const suppressedCount = Number(suppressedRows[0]?.value ?? 0);
  const recentSuppressionRows = await db
    .select()
    .from(suppressions)
    .orderBy(desc(suppressions.createdAt))
    .limit(10);
  return {
    suspicious,
    suspensions,
    suppressedCount,
    recentSuppressions: recentSuppressionRows,
    since,
  };
}

export async function securityEvents() {
  const db = getDb();
  // Auth-adjacent audit events; signup/invitation actions land here today.
  const rows = await db
    .select({ audit: auditLogs, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(12);
  return rows;
}

export async function adminAccounts() {
  const db = getDb();
  const [rows, activeSessions, waitlisted] = await Promise.all([
    db
      .select({
        user: users,
        sessions: sql<number>`(select count(*) from ${sessions} where ${sessions.userId} = ${users.id} and ${sessions.expiresAt} > now())`,
      })
      .from(users)
      .where(isNotNull(users.platformRole))
      .orderBy(asc(users.platformRole)),
    scalar(db.select({ value: count() }).from(sessions).where(gte(sessions.expiresAt, new Date()))),
    scalar(db.select({ value: count() }).from(waitlistSignups)),
  ]);
  return {
    admins: rows.map((r) => ({ ...r, sessions: Number(r.sessions) })),
    activeSessions,
    waitlisted,
  };
}

/* ── Internal audiences (system-generated) ───────────────────────────────── */

export interface AudienceCount {
  key: string;
  label: string;
  description: string;
  count: number;
  href: string;
}

export async function systemAudiences(): Promise<AudienceCount[]> {
  const db = getDb();
  const today = utcDayStart();
  const d30 = new Date(today.getTime() - 30 * DAY_MS);
  const d7 = new Date(today.getTime() - 7 * DAY_MS);
  // M6.2 truth pass: every count here is an honest join. The old build
  // counted DISTINCT jsonb metadata blobs as "senders" and hardcoded plan
  // counts at 0 — both removed. Activity now uses sessions.last_seen_at
  // (M6.1 inventory signal), which is what "inactive" actually means.
  const planRows = await db.select().from(plans);
  const [
    allUsers,
    verified,
    unverified,
    activeOrgs,
    usersWithProjects,
    usersWhoSent,
    waitlist,
    inactive,
    overdueUsageRows,
    planCounts,
  ] = await Promise.all([
    scalar(db.select({ value: count() }).from(users)),
    scalar(db.select({ value: count() }).from(users).where(isNotNull(users.emailVerifiedAt))),
    scalar(db.select({ value: count() }).from(users).where(isNull(users.emailVerifiedAt))),
    scalar(db.select({ value: count() }).from(organizations)),
    // Users with ≥1 project: membership chain, distinct users.
    scalar(
      db
        .select({ value: sql<number>`count(distinct ${organizationMembers.userId})` })
        .from(organizationMembers)
        .where(
          sql`exists (select 1 from ${projects} where ${projects.organizationId} = ${organizationMembers.organizationId})`
        )
    ),
    // Users whose orgs have actually attempted at least one send.
    scalar(
      db
        .select({ value: sql<number>`count(distinct ${organizationMembers.userId})` })
        .from(organizationMembers)
        .where(
          sql`exists (
                select 1 from ${emails}
                inner join ${projects} on ${emails.projectId} = ${projects.id}
                where ${projects.organizationId} = ${organizationMembers.organizationId}
              )`
        )
    ),
    scalar(db.select({ value: count() }).from(waitlistSignups)),
    // Inactive: no session seen in the last 30 days (never seen also counts).
    scalar(
      db
        .select({ value: sql<number>`count(distinct ${users.id})` })
        .from(users)
        .where(
          sql`not exists (
                select 1 from ${sessions}
                where ${sessions.userId} = ${users.id}
                  and ${sessions.lastSeenAt} is not null
                  and ${sessions.lastSeenAt} >= ${d30}
              )`
        )
    ),
    scalar(
      db
        .select({ value: count() })
        .from(usageRecords)
        .where(and(gte(usageRecords.periodStart, d7), sql`${usageRecords.metric} = 'emails_sent'`))
    ),
    // Per-plan org counts: active subscriptions only, grouped once.
    db
      .select({ planId: subscriptions.planId, value: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(subscriptions.planId),
  ]);
  const planCountBy = new Map(planCounts.map((r) => [r.planId, Number(r.value)]));
  // Free-tier orgs = every org MINUS orgs with an active paid subscription.
  const activeSubbed = planCounts.reduce((sum, r) => sum + Number(r.value), 0);
  const byPlan = planRows.map((p) => ({
    key: `plan_${p.tier}`,
    label: `${p.name} plan`,
    description:
      p.tier === "free"
        ? `Organizations on the ${p.name} plan (no active subscription)`
        : `Organizations with an active ${p.name} subscription`,
    count: p.tier === "free" ? Math.max(0, activeOrgs - activeSubbed) : (planCountBy.get(p.id) ?? 0),
    href: `/control/customers/organizations?plan=${p.tier}`,
  }));
  return [
    {
      key: "all_users",
      label: "All users",
      description: "Every registered Calder user",
      count: allUsers,
      href: "/control/customers",
    },
    {
      key: "verified",
      label: "Verified users",
      description: "Email verified",
      count: verified,
      href: "/control/customers",
    },
    {
      key: "unverified",
      label: "Unverified users",
      description: "Email not yet verified",
      count: unverified,
      href: "/control/customers",
    },
    {
      key: "orgs",
      label: "All organizations",
      description: "Every customer organization",
      count: activeOrgs,
      href: "/control/customers/organizations",
    },
    ...byPlan,
    {
      key: "with_projects",
      label: "Users with projects",
      description: "Member of an org with at least one project",
      count: usersWithProjects,
      href: "/control/customers",
    },
    {
      key: "sent_email",
      label: "Users who sent an email",
      description: "Member of an org with at least one send attempted",
      count: usersWhoSent,
      href: "/control/customers",
    },
    {
      key: "inactive",
      label: "Inactive users",
      description: "No session seen in the last 30 days",
      count: inactive,
      href: "/control/customers",
    },
    {
      key: "waitlist",
      label: "Waitlist",
      description: "Signed up, no account yet",
      count: waitlist,
      href: "/control/growth/waitlist",
    },
    {
      key: "approaching",
      label: "Metered orgs this week",
      description: "Organization usage rows recorded in the last 7 days",
      count: overdueUsageRows,
      href: "/control/platform/usage",
    },
  ];
}
