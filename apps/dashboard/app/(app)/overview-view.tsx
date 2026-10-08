import * as React from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Send } from "lucide-react";
import { RelativeTime } from "../../components/design-system";
import {
  OverviewSetupChecklist,
  OverviewVolumeChart,
  OverviewQuickstartCurl,
  type SetupStep,
} from "./overview-client";
import { formatRate, statusTone, type SeriesPoint } from "../../lib/overview-series";

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

export interface OverviewViewProps {
  greeting: string;
  subtitle: string;
  secondaryAction: { href: string; label: string; icon: React.ReactNode };
  setupSteps: SetupStep[];
  month: {
    total: number;
    delivered: number;
    failed: number;
    deliveryRate: number | null;
    failureRate: number | null;
  };
  pending: number;
  series: Record<"24h" | "7d" | "30d", SeriesPoint[]>;
  recent: Array<{ id: string; to: string; subject: string; status: string; createdAt: Date }>;
  usage: {
    planName: string;
    used: number;
    quota: number | null;
    percent: number;
    resetsOn: string | null;
  };
  setupRows: ReadonlyArray<{
    label: string;
    icon: React.ReactNode;
    value: string;
    tone: string;
    href: string;
  }>;
  pricingHref: string;
}

export function OverviewView({
  greeting,
  subtitle,
  secondaryAction,
  setupSteps,
  month,
  pending,
  series,
  recent,
  usage,
  setupRows,
  pricingHref,
}: OverviewViewProps) {
  const failureHigh = (month.failureRate ?? 0) > 2;

  return (
    <div className="ov">
      <header className="ov-header">
        <div className="ov-header-text">
          <h1 className="ov-title">{greeting}</h1>
          <p className="ov-sub">{subtitle}</p>
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
          <span className="ov-metric-value tabular-nums">{pending.toLocaleString()}</span>
          <span className="ov-metric-sub">Queued or sending now</span>
        </div>
      </section>

      <OverviewVolumeChart series={series} />

      <div className="ov-split">
        <section className="ov-panel" aria-labelledby="ov-recent-title">
          <div className="ov-panel-head">
            <h2 className="ov-panel-title" id="ov-recent-title">
              Recent emails
            </h2>
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
          <section className="ov-panel" aria-labelledby="ov-usage-title">
            <div className="ov-panel-head">
              <h2 className="ov-panel-title" id="ov-usage-title">
                Usage
              </h2>
              <span className="ov-chip">{usage.planName}</span>
            </div>
            <div className="ov-panel-body">
              <div className="ov-usage-figure tabular-nums">
                {usage.used.toLocaleString()}
                <span> / {usage.quota === null ? "Unlimited" : usage.quota.toLocaleString()}</span>
              </div>
              <div
                className="ov-meter"
                role="progressbar"
                aria-valuenow={Math.round(usage.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Emails used this billing period"
              >
                <div
                  className={`ov-meter-fill ${usage.percent > 95 ? "is-danger" : usage.percent > 80 ? "is-warning" : ""}`}
                  style={{ width: `${Math.max(1.5, usage.percent)}%` }}
                />
              </div>
              <p className="ov-usage-note">
                {usage.resetsOn
                  ? `Emails this billing period · resets ${usage.resetsOn}`
                  : "Emails this billing period"}
              </p>
              <div className="ov-usage-links">
                <Link href="/usage" className="ov-link">
                  Usage details <ArrowRight size={13} />
                </Link>
                <a href={pricingHref} className="ov-link is-muted">
                  Compare plans <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
          </section>

          <section className="ov-panel" aria-labelledby="ov-setup-title">
            <div className="ov-panel-head">
              <h2 className="ov-panel-title" id="ov-setup-title">
                Sending setup
              </h2>
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
