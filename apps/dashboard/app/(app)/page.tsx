import { desc, inArray, count, isNull, and, eq, gte, sql } from "drizzle-orm";
import { getDb, emails, domains, apiKeys, webhooks, orgUsageSnapshot } from "@calder/db";
import { PLAN_LIMITS, planEmailsLimit, type PlanTier } from "@calder/config";
import { getTenantContext } from "../../lib/auth";
import { Globe, KeyRound, Webhook, ShieldBan } from "lucide-react";
import type { SetupStep } from "./overview-client";
import { OverviewView } from "./overview-view";
import {
  buildDailySeries,
  buildHourlySeries,
  summarize,
  type BucketCountRow,
  type StatusCountRow,
} from "../../lib/overview-series";
import { pricingUrl } from "../../lib/pricing";

const DAY_MS = 86_400_000;

export default async function OverviewPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  const db = getDb();
  const now = new Date();

  let allTime: StatusCountRow[] = [];
  let last30: StatusCountRow[] = [];
  let dailyRows: BucketCountRow[] = [];
  let hourlyRows: BucketCountRow[] = [];
  let recent: Array<{
    id: string;
    to: string;
    subject: string;
    status: string;
    createdAt: Date;
  }> = [];

  let domainTotal = 0;
  let verifiedDomainTotal = 0;
  let activeKeyTotal = 0;
  let webhookTotal = 0;

  if (projectIds.length > 0) {
    const scope = inArray(emails.projectId, projectIds);
    const since30 = new Date(now.getTime() - 29 * DAY_MS);
    since30.setUTCHours(0, 0, 0, 0);
    const since24h = new Date(now.getTime() - 23 * 3_600_000);
    since24h.setUTCMinutes(0, 0, 0);

    const dayBucket = sql<string>`to_char(${emails.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const hourBucket = sql<string>`to_char(${emails.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24')`;

    [allTime, dailyRows, hourlyRows, recent] = await Promise.all([
      db
        .select({ status: emails.status, value: count() })
        .from(emails)
        .where(scope)
        .groupBy(emails.status),
      db
        .select({ bucket: dayBucket, status: emails.status, value: count() })
        .from(emails)
        .where(and(scope, gte(emails.createdAt, since30)))
        .groupBy(dayBucket, emails.status),
      db
        .select({ bucket: hourBucket, status: emails.status, value: count() })
        .from(emails)
        .where(and(scope, gte(emails.createdAt, since24h)))
        .groupBy(hourBucket, emails.status),
      db
        .select({
          id: emails.id,
          to: emails.to,
          subject: emails.subject,
          status: emails.status,
          createdAt: emails.createdAt,
        })
        .from(emails)
        .where(scope)
        .orderBy(desc(emails.createdAt))
        .limit(8),
    ]);
    last30 = dailyRows;

    try {
      const [[domAll], [domVer], [keysRow], [hooksRow]] = await Promise.all([
        db.select({ value: count() }).from(domains).where(inArray(domains.projectId, projectIds)),
        db
          .select({ value: count() })
          .from(domains)
          .where(and(inArray(domains.projectId, projectIds), eq(domains.status, "verified"))),
        db
          .select({ value: count() })
          .from(apiKeys)
          .where(and(inArray(apiKeys.projectId, projectIds), isNull(apiKeys.revokedAt))),
        db.select({ value: count() }).from(webhooks).where(inArray(webhooks.projectId, projectIds)),
      ]);
      domainTotal = domAll?.value ?? 0;
      verifiedDomainTotal = domVer?.value ?? 0;
      activeKeyTotal = keysRow?.value ?? 0;
      webhookTotal = hooksRow?.value ?? 0;
    } catch {
      // best-effort counts
    }
  }

  const lifetime = summarize(allTime);
  const month = summarize(last30);
  const daily = buildDailySeries(dailyRows, 30, now);
  const series = {
    "24h": buildHourlySeries(hourlyRows, 24, now),
    "7d": daily.slice(-7),
    "30d": daily,
  };

  // Plan usage for the first organization's current billing period.
  let quota: number | null = PLAN_LIMITS.free.emailsPerMonth;
  let planName = PLAN_LIMITS.free.displayName;
  let usedThisPeriod = 0;
  let periodEnd: Date | null = null;
  const firstOrg = ctx.memberships[0]?.organization;
  if (firstOrg) {
    try {
      const snap = await orgUsageSnapshot(db, firstOrg.id);
      quota = planEmailsLimit(snap.tier);
      planName = PLAN_LIMITS[snap.tier as PlanTier]?.displayName ?? planName;
      usedThisPeriod = snap.acceptedLive;
      periodEnd = snap.period.end;
    } catch {
      // keep free-tier defaults
    }
  }
  const usagePct = quota ? Math.min(100, (usedThisPeriod / Math.max(quota, 1)) * 100) : 0;

  const meName = (ctx.user as { name?: string | null }).name?.trim();
  const firstName =
    meName?.split(/\s+/)[0] ??
    ctx.user.email
      .split("@")[0]
      ?.replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ??
    "there";
  const utcHour = now.getUTCHours();
  const salutation =
    utcHour < 12 ? "Good morning" : utcHour < 18 ? "Good afternoon" : "Good evening";

  const setupSteps: SetupStep[] = [
    {
      id: "org",
      title: "Create your workspace",
      description: "An organization and project to keep keys, domains and logs isolated.",
      done: ctx.memberships.length > 0 && projectIds.length > 0,
      href: "/settings#workspace",
      cta: "Create workspace",
    },
    {
      id: "domain",
      title: domainTotal > 0 ? "Verify your sending domain" : "Add a sending domain",
      description: "Publish the DKIM, SPF and DMARC records so mail lands in the inbox.",
      done: verifiedDomainTotal > 0,
      href: "/domains",
      cta: domainTotal > 0 ? "Check DNS" : "Add domain",
    },
    {
      id: "key",
      title: "Create an API key",
      description: "A scoped key your application uses to send through Calder.",
      done: activeKeyTotal > 0,
      href: "/keys",
      cta: "Create key",
    },
    {
      id: "email",
      title: "Send your first email",
      description: "From the composer, the REST API, an SDK or SMTP.",
      done: lifetime.total > 0,
      href: "/emails/new",
      cta: "Send email",
    },
    {
      id: "webhook",
      title: "Listen for events",
      description: "Get delivery, bounce and complaint events pushed to your endpoint.",
      done: webhookTotal > 0,
      href: "/webhooks",
      cta: "Add endpoint",
      optional: true,
    },
  ];

  const secondaryAction =
    verifiedDomainTotal === 0
      ? { href: "/domains", label: "Add domain", icon: <Globe size={14} /> }
      : activeKeyTotal === 0
        ? { href: "/keys", label: "Create API key", icon: <KeyRound size={14} /> }
        : { href: "/emails", label: "View emails", icon: null };

  const setupRows = [
    {
      label: "Domains",
      icon: <Globe size={14} />,
      value:
        verifiedDomainTotal > 0
          ? `${verifiedDomainTotal} verified`
          : domainTotal > 0
            ? `${domainTotal} awaiting DNS`
            : "None added",
      tone: verifiedDomainTotal > 0 ? "success" : domainTotal > 0 ? "warning" : "neutral",
      href: "/domains",
    },
    {
      label: "API keys",
      icon: <KeyRound size={14} />,
      value: activeKeyTotal > 0 ? `${activeKeyTotal} active` : "None yet",
      tone: activeKeyTotal > 0 ? "success" : "neutral",
      href: "/keys",
    },
    {
      label: "Webhooks",
      icon: <Webhook size={14} />,
      value:
        webhookTotal > 0 ? `${webhookTotal} endpoint${webhookTotal === 1 ? "" : "s"}` : "Optional",
      tone: webhookTotal > 0 ? "success" : "neutral",
      href: "/webhooks",
    },
    {
      label: "Suppressions",
      icon: <ShieldBan size={14} />,
      value: "Automatic",
      tone: "success",
      href: "/suppressions",
    },
  ] as const;

  const projectCount = projectIds.length;

  return (
    <OverviewView
      greeting={`${salutation}, ${firstName}`}
      subtitle={
        ctx.memberships.length === 0
          ? "You don't belong to an organization yet. Create one to start sending."
          : `${firstOrg?.name ?? "Workspace"} · ${projectCount} project${projectCount === 1 ? "" : "s"}`
      }
      secondaryAction={secondaryAction}
      setupSteps={setupSteps}
      month={month}
      pending={lifetime.pending}
      series={series}
      recent={recent}
      usage={{
        planName,
        used: usedThisPeriod,
        quota,
        percent: usagePct,
        resetsOn: periodEnd
          ? periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
          : null,
      }}
      setupRows={setupRows}
      pricingHref={pricingUrl()}
    />
  );
}
