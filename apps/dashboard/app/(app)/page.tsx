import Link from "next/link";
import { desc, inArray, count, isNull, and, eq } from "drizzle-orm";
import { getDb, emails, domains, apiKeys, webhooks, orgUsageSnapshot } from "@calder/db";
import { planEmailsLimit } from "@calder/config";
import { getTenantContext } from "../../lib/auth";
import {
  LayoutDashboard,
  Send,
  KeyRound,
  Globe,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  ArrowRight,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import {
  DsPageHeader,
  StatCard,
  StatusPill,
  RelativeTime,
} from "../../components/design-system";
import {
  OverviewSetupChecklist,
  OverviewTelemetryChart,
  OverviewQuickstartCurl,
  type SetupStep,
} from "./overview-client";
import { pricingUrl } from "../../lib/pricing";

export default async function OverviewPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  const db = getDb();

  const stats = { sent: 0, delivered: 0, queued: 0, failed: 0 };
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
    const byStatus = await db
      .select({ status: emails.status, value: count() })
      .from(emails)
      .where(inArray(emails.projectId, projectIds))
      .groupBy(emails.status);
    for (const row of byStatus) {
      if (row.status === "sent" || row.status === "delivered") {
        stats.sent += row.value;
        if (row.status === "delivered") stats.delivered += row.value;
      } else if (row.status === "queued" || row.status === "sending") {
        stats.queued += row.value;
      } else {
        stats.failed += row.value;
      }
    }
    recent = await db
      .select({
        id: emails.id,
        to: emails.to,
        subject: emails.subject,
        status: emails.status,
        createdAt: emails.createdAt,
      })
      .from(emails)
      .where(inArray(emails.projectId, projectIds))
      .orderBy(desc(emails.createdAt))
      .limit(10);

    try {
      const [domAll] = await db
        .select({ value: count() })
        .from(domains)
        .where(inArray(domains.projectId, projectIds));
      domainTotal = domAll?.value ?? 0;

      const [domVer] = await db
        .select({ value: count() })
        .from(domains)
        .where(and(inArray(domains.projectId, projectIds), eq(domains.status, "verified")));
      verifiedDomainTotal = domVer?.value ?? 0;

      const [keysRow] = await db
        .select({ value: count() })
        .from(apiKeys)
        .where(and(inArray(apiKeys.projectId, projectIds), isNull(apiKeys.revokedAt)));
      activeKeyTotal = keysRow?.value ?? 0;

      const [hooksRow] = await db
        .select({ value: count() })
        .from(webhooks)
        .where(inArray(webhooks.projectId, projectIds));
      webhookTotal = hooksRow?.value ?? 0;
    } catch {
      // best-effort counts
    }
  }

  // Usage meter derived from active organization plan tier (Beginner 5k, Pro 50k, Scale 250k)
  let quota = 5000;
  const firstOrg = ctx.memberships[0]?.organization;
  if (firstOrg) {
    try {
      const snap = await orgUsageSnapshot(db, firstOrg.id);
      quota = planEmailsLimit(snap.tier) ?? 50000;
    } catch {
      quota = 5000;
    }
  }
  const usagePct = Math.min(100, (stats.sent / Math.max(quota, 1)) * 100);
  const deliveryRate =
    stats.sent > 0 ? `${((stats.delivered / stats.sent) * 100).toFixed(1)}%` : "100.0%";
  const bounceRateNum = stats.sent > 0 ? (stats.failed / stats.sent) * 100 : 0;
  const bounceRate = `${bounceRateNum.toFixed(2)}%`;

  const firstProject = ctx.memberships[0]?.projects[0] as
    | { name: string; metadata?: { environment?: string } | null }
    | undefined;
  const rawName =
    (ctx.user as { name?: string }).name ??
    ctx.user.email
      .split("@")[0]
      ?.replace(/[._-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ??
    "there";
  const utcHour = new Date().getUTCHours();
  const salutation =
    utcHour < 12 ? "Good morning" : utcHour < 18 ? "Good afternoon" : "Good evening";
  const greeting = `${salutation}, ${rawName}.`;

  const setupSteps: SetupStep[] = [
    {
      id: "org",
      title: "Create organization & project",
      description: "Provision an isolated workspace for your team and environments.",
      done: ctx.memberships.length > 0 && projectIds.length > 0,
      href: "/settings#workspace",
      cta: "Configure workspace",
    },
    {
      id: "domain",
      title: "Add & verify sending domain",
      description: "Publish 2048-bit DKIM, SPF, and DMARC DNS records.",
      done: verifiedDomainTotal > 0,
      href: "/domains",
      cta: domainTotal > 0 ? "Verify DNS records" : "Add domain",
    },
    {
      id: "key",
      title: "Create a scoped API key",
      description: "Issue an Argon2id-hashed bearer credential for your app.",
      done: activeKeyTotal > 0,
      href: "/keys",
      cta: "Create API key",
    },
    {
      id: "email",
      title: "Send your first test email",
      description: "Dispatch a live or sandbox payload via REST or Composer.",
      done: stats.sent > 0,
      href: "/emails/new",
      cta: "Send test email",
    },
    {
      id: "webhook",
      title: "Configure a webhook endpoint",
      description: "Subscribe to real-time delivery, bounce, and complaint events.",
      done: webhookTotal > 0,
      href: "/webhooks",
      cta: "Add endpoint",
      optional: true,
    },
  ];

  const healthItems = [
    {
      label: "Sending Domains",
      detail:
        verifiedDomainTotal > 0
          ? `${verifiedDomainTotal} verified`
          : domainTotal > 0
            ? `${domainTotal} pending DNS`
            : "No domain added",
      status: verifiedDomainTotal > 0 ? "verified" : "pending",
      href: "/domains",
    },
    {
      label: "Scoped API Keys",
      detail: activeKeyTotal > 0 ? `${activeKeyTotal} active` : "None issued yet",
      status: activeKeyTotal > 0 ? "active" : "pending",
      href: "/keys",
    },
    {
      label: "Webhook Endpoints",
      detail: webhookTotal > 0 ? `${webhookTotal} subscribed` : "Optional",
      status: webhookTotal > 0 ? "active" : "queued",
      href: "/webhooks",
    },
    {
      label: "Suppression Protection",
      detail: "Hard-bounce & FBL auto-guard enabled",
      status: "healthy",
      href: "/suppressions",
    },
  ];

  return (
    <div>
      <DsPageHeader
        icon={<LayoutDashboard size={18} />}
        title={greeting}
        badge={
          firstProject ? (
            <StatusPill
              status={
                (firstProject.metadata?.environment ?? "development") === "production"
                  ? "live"
                  : "test"
              }
              label={`${firstProject.name} · ${(firstProject.metadata?.environment as string) ?? "development"}`}
            />
          ) : undefined
        }
        description={
          ctx.memberships.length === 0
            ? "You don't belong to any organization yet. Create your organization to start sending."
            : `${new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })} · Command center across ${projectIds.length} project${
                projectIds.length === 1 ? "" : "s"
              }.`
        }
        actions={
          <>
            <Link
              href="/domains"
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <Globe size={14} />
              <span>Add domain</span>
            </Link>
            <Link
              href="/keys"
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <KeyRound size={14} />
              <span>Create API key</span>
            </Link>
            <Link
              href="/emails/new"
              className="ds-btn ds-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <Send size={14} />
              <span>Send test email</span>
            </Link>
          </>
        }
      />

      {/* Setup Checklist Card */}
      <OverviewSetupChecklist steps={setupSteps} />

      {/* 4-Card KPI Metric Strip */}
      <div className="ds-grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          label="Emails Sent"
          value={stats.sent.toLocaleString()}
          icon={<Send size={15} />}
          delta={{ value: "30d window", positive: true }}
          sub={`${(quota - stats.sent).toLocaleString()} remaining in cycle`}
        />
        <StatCard
          label="Delivered"
          value={stats.delivered.toLocaleString()}
          icon={<CheckCircle2 size={15} />}
          status="delivered"
          sub={`Delivery rate: ${deliveryRate}`}
        />
        <StatCard
          label="Queued / In-flight"
          value={stats.queued.toLocaleString()}
          icon={<Clock size={15} />}
          sub="Sub-second SES queue dispatch"
        />
        <StatCard
          label="Bounced / Failed"
          value={stats.failed.toLocaleString()}
          icon={<AlertTriangle size={15} />}
          status={bounceRateNum > 2 ? "bounced" : "healthy"}
          sub={`Bounce rate: ${bounceRate} (threshold < 2.0%)`}
        />
      </div>

      {/* Volume & Deliverability Telemetry Chart */}
      <OverviewTelemetryChart
        sent={stats.sent}
        delivered={stats.delivered}
        failed={stats.failed}
      />

      {/* Two-column lower grid: Recent Activity (Left) + Infrastructure Health & Plan Usage (Right) */}
      <div className="ds-grid-2">
        {/* Left: Recent Activity / Live Stream */}
        <section className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Recent Activity & Live Stream</h2>
              <p className="ds-card-subtitle">
                Latest 10 outbound messages and delivery events
              </p>
            </div>
            <Link
              href="/emails"
              className="ds-btn ds-btn-ghost ds-btn-sm"
              style={{ textDecoration: "none" }}
            >
              <span>View all</span>
              <ArrowRight size={13} />
            </Link>
          </div>
          <div className="ds-card-body">
            {recent.length === 0 ? (
              <div style={{ textAlign: "center", padding: "12px 4px" }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "var(--color-surface-elevated)",
                    border: "1px solid var(--color-border)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-muted)",
                    marginBottom: 10,
                  }}
                >
                  <Mail size={18} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                  No emails dispatched yet
                </div>
                <p
                  style={{
                    fontSize: 12.5,
                    color: "var(--color-muted)",
                    margin: "0 auto 14px",
                    maxWidth: 400,
                  }}
                >
                  Send your first transactional email from the interactive composer or copy the cURL snippet below.
                </p>
                <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                  <Link
                    href="/emails/new"
                    className="ds-btn ds-btn-primary ds-btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    <Send size={13} />
                    <span>Send test email</span>
                  </Link>
                  <Link
                    href="/sdks"
                    className="ds-btn ds-btn-secondary ds-btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    <span>Explore SDKs</span>
                  </Link>
                </div>
                <OverviewQuickstartCurl />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {recent.map((e, i) => (
                  <Link
                    key={e.id}
                    href={`/emails?inspect=${encodeURIComponent(e.id)}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 6px",
                      borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                      textDecoration: "none",
                      color: "var(--color-ink)",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {e.subject}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          color: "var(--color-muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        → {e.to}
                      </div>
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <StatusPill status={e.status} />
                      <RelativeTime value={e.createdAt} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right: Infrastructure Health & Monthly Plan Usage */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <section className="ds-card">
            <div className="ds-card-header">
              <div>
                <h2 className="ds-card-title">Monthly Plan Usage</h2>
                <p className="ds-card-subtitle">
                  Free Tier · Resets on the 1st of next month
                </p>
              </div>
              <a
                href={pricingUrl()}
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <Sparkles size={13} style={{ color: "var(--color-accent)" }} />
                <span>Upgrade to Pro</span>
              </a>
            </div>
            <div className="ds-card-body">
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span className="mono tabular-nums" style={{ fontSize: 20, fontWeight: 700 }}>
                  {stats.sent.toLocaleString()}{" "}
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-muted)" }}>
                    / {quota.toLocaleString()} emails
                  </span>
                </span>
                <span className="mono tabular-nums" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  {usagePct.toFixed(1)}% used
                </span>
              </div>
              <div
                style={{
                  height: 8,
                  background: "var(--color-surface-sunken)",
                  borderRadius: 99,
                  overflow: "hidden",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    width: `${Math.max(2, usagePct)}%`,
                    height: "100%",
                    background:
                      usagePct > 95
                        ? "var(--color-danger)"
                        : usagePct > 80
                          ? "var(--color-warning)"
                          : "var(--color-accent)",
                    transition: "width 300ms ease",
                  }}
                />
              </div>
              <p style={{ fontSize: 12, color: "var(--color-muted)", margin: 0 }}>
                {usagePct >= 95
                  ? `Only ${(quota - stats.sent).toLocaleString()} remaining — upgrade to Pro for 50,000+ monthly volume.`
                  : `${(quota - stats.sent).toLocaleString()} emails remaining in current billing period · Daily cap: 200/day.`}
              </p>
            </div>
          </section>

          <section className="ds-card">
            <div className="ds-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={16} style={{ color: "var(--color-success)" }} />
                <div>
                  <h2 className="ds-card-title">Infrastructure Health</h2>
                  <p className="ds-card-subtitle">
                    Authentication, credentials, and event routing checklist
                  </p>
                </div>
              </div>
            </div>
            <div className="ds-card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
              {healthItems.map((item, idx) => (
                <Link
                  key={item.label}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "11px 4px",
                    borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
                    textDecoration: "none",
                    color: "var(--color-ink)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--color-muted)" }}>{item.detail}</div>
                  </div>
                  <StatusPill status={item.status} />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
