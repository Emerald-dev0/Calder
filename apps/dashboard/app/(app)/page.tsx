import Link from "next/link";
import { desc, inArray, count, isNull, and, eq, gte, sql } from "drizzle-orm";
import { getDb, emails, domains, apiKeys, webhooks, orgUsageSnapshot } from "@calder/db";
import { PLAN_LIMITS, planEmailsLimit, type PlanTier } from "@calder/config";
import { getTenantContext } from "../../lib/auth";
import { ArrowRight, ArrowUpRight, Globe, KeyRound, Send, Webhook, ShieldBan } from "lucide-react";
import { RelativeTime } from "../../components/design-system";
import {
  OverviewSetupChecklist,
  OverviewVolumeChart,
  OverviewQuickstartCurl,
  type SetupStep,
} from "./overview-client";
import {
  buildDailySeries,
  buildHourlySeries,
  formatRate,
  statusTone,
  summarize,
  type BucketCountRow,
  type StatusCountRow,
} from "../../lib/overview-series";
import { pricingUrl } from "../../lib/pricing";

const DAY_MS = 86_400_000;

const STATUS_LABEL: Record<string, string> = {
  created: "Created",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Complained",
  failed: "Failed",
  suppressed: "Suppressed",
};

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

  const failureHigh = (month.failureRate ?? 0) > 2;
  const projectCount = projectIds.length;

  return (
    <div className="ov">
      <header className="ov-header">
        <div className="ov-header-text">
          <h1 className="ov-title">
            {salutation}, {firstName}
          </h1>
          <p className="ov-sub">
            {ctx.memberships.length === 0
              ? "You don't belong to an organization yet. Create one to start sending."
              : `${firstOrg?.name ?? "Workspace"} · ${projectCount} project${projectCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="ov-actions">
          <Link href={secondaryAction.href} className="ds-btn ds-btn-secondary">
            {secondaryAction.icon}
            <span>{secondaryAction.label}</span>
          </Link>
          <Link href="/emails/new" className="ds-btn ds-btn-primary">
            <Send size={14} />
            <span>Send email</span>
          </Link>
        </div>
      </header>

      <OverviewSetupChecklist steps={setupSteps} />

      <section className="ov-metrics" aria-label="Last 30 days">
        <div className="ov-metric">
          <span className="ov-metric-label">Emails sent</span>
          <span className="ov-metric-value tabular-nums">{month.total.toLocaleString()}</span>
          <span className="ov-metric-sub">Last 30 days</span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">Delivery rate</span>
          <span className="ov-metric-value tabular-nums">{formatRate(month.deliveryRate)}</span>
          <span className="ov-metric-sub">{month.delivered.toLocaleString()} delivered</span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">Bounce &amp; failure rate</span>
          <span className="ov-metric-value tabular-nums">{formatRate(month.failureRate)}</span>
          <span className={`ov-metric-sub ${failureHigh ? "is-danger" : ""}`}>
            {failureHigh
              ? "Above the 2% threshold"
              : `${month.failed.toLocaleString()} bounced or failed`}
          </span>
        </div>
        <div className="ov-metric">
          <span className="ov-metric-label">In queue</span>
          <span className="ov-metric-value tabular-nums">{lifetime.pending.toLocaleString()}</span>
          <span className="ov-metric-sub">Queued or sending now</span>
        </div>
      </section>

      <OverviewVolumeChart series={series} />

      <div className="ov-split">
        <section className="ov-panel">
          <div className="ov-panel-head">
            <h2 className="ov-panel-title">Recent emails</h2>
            {recent.length > 0 && (
              <Link href="/emails" className="ov-link">
                View all <ArrowRight size={13} />
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="ov-empty">
              <div className="ov-empty-title">No emails yet</div>
              <p className="ov-empty-text">
                Send one from the composer, or call the API with the snippet below.
              </p>
              <div className="ov-empty-actions">
                <Link href="/emails/new" className="ds-btn ds-btn-primary ds-btn-sm">
                  <Send size={13} />
                  <span>Send test email</span>
                </Link>
                <Link href="/sdks" className="ds-btn ds-btn-secondary ds-btn-sm">
                  <span>Explore SDKs</span>
                </Link>
              </div>
              <OverviewQuickstartCurl />
            </div>
          ) : (
            <ul className="ov-rows">
              {recent.map((e) => (
                <li key={e.id}>
                  <Link href={`/emails?inspect=${encodeURIComponent(e.id)}`} className="ov-row">
                    <span className={`ov-status ov-tone-${statusTone(e.status)}`}>
                      <span className="ov-dot" aria-hidden="true" />
                      <span className="ov-status-label">{STATUS_LABEL[e.status] ?? e.status}</span>
                    </span>
                    <span className="ov-row-main">
                      <span className="ov-row-subject">{e.subject}</span>
                      <span className="ov-row-to">{e.to}</span>
                    </span>
                    <span className="ov-row-time">
                      <RelativeTime value={e.createdAt} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="ov-side">
          <section className="ov-panel">
            <div className="ov-panel-head">
              <h2 className="ov-panel-title">Usage</h2>
              <span className="ov-chip">{planName}</span>
            </div>
            <div className="ov-panel-body">
              <div className="ov-usage-figure tabular-nums">
                {usedThisPeriod.toLocaleString()}
                <span> / {quota === null ? "Unlimited" : quota.toLocaleString()}</span>
              </div>
              <div className="ov-meter" aria-hidden="true">
                <div
                  className={`ov-meter-fill ${usagePct > 95 ? "is-danger" : usagePct > 80 ? "is-warning" : ""}`}
                  style={{ width: `${Math.max(1.5, usagePct)}%` }}
                />
              </div>
              <p className="ov-usage-note">
                {periodEnd
                  ? `Emails this billing period · resets ${periodEnd.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}`
                  : "Emails this billing period"}
              </p>
              <div className="ov-usage-links">
                <Link href="/usage" className="ov-link">
                  Usage details <ArrowRight size={13} />
                </Link>
                <a href={pricingUrl()} className="ov-link is-muted">
                  Compare plans <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
          </section>

          <section className="ov-panel">
            <div className="ov-panel-head">
              <h2 className="ov-panel-title">Sending setup</h2>
            </div>
            <ul className="ov-rows">
              {setupRows.map((row) => (
                <li key={row.label}>
                  <Link href={row.href} className="ov-kv">
                    <span className="ov-kv-label">
                      <span className="ov-kv-icon">{row.icon}</span>
                      {row.label}
                    </span>
                    <span className={`ov-status ov-tone-${row.tone}`}>
                      <span className="ov-dot" aria-hidden="true" />
                      <span>{row.value}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
