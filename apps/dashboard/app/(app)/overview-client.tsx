"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ArrowRight, ChevronDown, X } from "lucide-react";
import { CodeBlock } from "../../components/design-system";
import type { SeriesPoint } from "../../lib/overview-series";

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  optional?: boolean;
}

const DISMISS_KEY = "calder_overview_setup_dismissed";

export function OverviewSetupChecklist({ steps }: { steps: SetupStep[] }) {
  const [dismissed, setDismissed] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      // ignore storage errors
    }
  }, []);

  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.every((s) => s.done);
  const completed = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);

  if (dismissed || !next || requiredDone) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <section className="ov-setup" aria-label="Setup checklist">
      <div className="ov-setup-head">
        <div className="ov-setup-heading">
          <h2 className="ov-panel-title">Finish setting up</h2>
          <span className="ov-setup-count tabular-nums">
            {completed} of {steps.length}
          </span>
          <span className="ov-setup-track" aria-hidden="true">
            {steps.map((s) => (
              <span key={s.id} className={`ov-setup-seg ${s.done ? "is-done" : ""}`} />
            ))}
          </span>
        </div>
        <div className="ov-setup-tools">
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand setup checklist" : "Collapse setup checklist"}
          >
            <ChevronDown
              size={15}
              style={{
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 150ms ease",
              }}
            />
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
            onClick={dismiss}
            aria-label="Dismiss setup checklist"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <ol className="ov-steps">
          {steps.map((step, i) => {
            const isNext = step.id === next.id;
            return (
              <li
                key={step.id}
                className={`ov-step ${step.done ? "is-done" : ""} ${isNext ? "is-next" : ""}`}
              >
                <span className="ov-step-mark" aria-hidden="true">
                  {step.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <div className="ov-step-text">
                  <span className="ov-step-title">
                    {step.title}
                    {step.optional && <span className="ov-step-opt">Optional</span>}
                  </span>
                  {isNext && <span className="ov-step-desc">{step.description}</span>}
                </div>
                {step.done ? (
                  <span className="ov-step-state">Done</span>
                ) : isNext ? (
                  <Link href={step.href} className="ds-btn ds-btn-primary ds-btn-sm">
                    <span>{step.cta}</span>
                    <ArrowRight size={13} />
                  </Link>
                ) : (
                  <Link href={step.href} className="ov-link is-muted">
                    {step.cta}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

type Range = "24h" | "7d" | "30d";

const RANGE_LABEL: Record<Range, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function OverviewVolumeChart({ series }: { series: Record<Range, SeriesPoint[]> }) {
  const [range, setRange] = React.useState<Range>("7d");
  const [hover, setHover] = React.useState<number | null>(null);
  const points = series[range];

  const totals = points.reduce(
    (acc, p) => ({ delivered: acc.delivered + p.delivered, failed: acc.failed + p.failed }),
    { delivered: 0, failed: 0 }
  );
  const max = niceMax(Math.max(0, ...points.map((p) => p.delivered + p.failed)));
  const empty = totals.delivered + totals.failed === 0;
  const labelEvery = points.length > 14 ? 5 : points.length > 7 ? 4 : 1;
  const hovered = hover !== null ? points[hover] : null;

  return (
    <section className="ov-panel ov-chart" aria-label="Sending volume">
      <div className="ov-panel-head">
        <div className="ov-chart-heading">
          <h2 className="ov-panel-title">Sending volume</h2>
          <div className="ov-legend">
            <span className="ov-legend-item">
              <span className="ov-swatch is-delivered" />
              Delivered <b className="tabular-nums">{totals.delivered.toLocaleString()}</b>
            </span>
            <span className="ov-legend-item">
              <span className="ov-swatch is-failed" />
              Bounced / failed <b className="tabular-nums">{totals.failed.toLocaleString()}</b>
            </span>
          </div>
        </div>
        <div className="ds-tabs" role="tablist" aria-label="Time range">
          {(["24h", "7d", "30d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => {
                setRange(r);
                setHover(null);
              }}
              className={`ds-tab ${range === r ? "is-active" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="ov-chart-body">
        <div className="ov-chart-axis" aria-hidden="true">
          <span className="tabular-nums">{max.toLocaleString()}</span>
          <span className="tabular-nums">{(max / 2).toLocaleString()}</span>
          <span className="tabular-nums">0</span>
        </div>
        <div className="ov-chart-plot">
          <div className="ov-chart-grid" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div
            className="ov-chart-bars"
            style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
            onMouseLeave={() => setHover(null)}
          >
            {points.map((p, i) => {
              const dPct = (p.delivered / max) * 100;
              const fPct = (p.failed / max) * 100;
              return (
                <div
                  key={p.key}
                  className={`ov-bar-col ${hover === i ? "is-hover" : ""}`}
                  onMouseEnter={() => setHover(i)}
                  title={`${p.label}: ${p.delivered} delivered, ${p.failed} bounced/failed`}
                >
                  <div className="ov-bar-stack">
                    {p.failed > 0 && (
                      <div className="ov-bar is-failed" style={{ height: `${fPct}%` }} />
                    )}
                    {p.delivered > 0 && (
                      <div className="ov-bar is-delivered" style={{ height: `${dPct}%` }} />
                    )}
                  </div>
                  <span className="ov-bar-label tabular-nums">
                    {i % labelEvery === (points.length - 1) % labelEvery ? p.label : ""}
                  </span>
                </div>
              );
            })}
          </div>
          {hovered && !empty && (
            <div className="ov-chart-tip" role="status">
              <b>{hovered.label}</b>
              <span className="tabular-nums">{hovered.delivered.toLocaleString()} delivered</span>
              <span className="tabular-nums">{hovered.failed.toLocaleString()} bounced/failed</span>
            </div>
          )}
          {empty && (
            <div className="ov-chart-empty">
              <span>No emails in the {RANGE_LABEL[range].toLowerCase()}.</span>
              <Link href="/emails/new" className="ov-link">
                Send a test email <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>
      </div>
      <div className="ov-chart-foot">{RANGE_LABEL[range]} · UTC</div>
    </section>
  );
}

export function OverviewQuickstartCurl() {
  return (
    <div style={{ marginTop: 16, textAlign: "left" }}>
      <CodeBlock
        title="Quickstart cURL"
        code={`curl -X POST https://api.calder.build/v1/emails \\
  -H "Authorization: Bearer $CALDER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "onboarding@calder.build",
    "to": ["ada@analytical.dev"],
    "subject": "Hello from Calder",
    "html": "<strong>Your transactional pipeline is live.</strong>"
  }'`}
      />
    </div>
  );
}
