"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ArrowRight, ChevronDown, X } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
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
      // ignore
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

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomRechartsTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "#0d0f12",
        border: "1px solid #1f242c",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
      }}
    >
      <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "#8a94a6" }}>
        {label}
      </p>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#e1e7f0",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: entry.color,
            }}
          />
          <span style={{ textTransform: "capitalize" }}>{entry.name}:</span>
          <strong style={{ fontWeight: 600 }}>{entry.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}

export function OverviewVolumeChart({ series }: { series: Record<Range, SeriesPoint[]> }) {
  const [range, setRange] = React.useState<Range>("7d");
  const points = series[range];

  const totals = points.reduce(
    (acc, p) => ({ delivered: acc.delivered + p.delivered, failed: acc.failed + p.failed }),
    { delivered: 0, failed: 0 }
  );

  const empty = totals.delivered + totals.failed === 0;

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
              onClick={() => setRange(r)}
              className={`ds-tab ${range === r ? "is-active" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="ov-chart-body" style={{ height: 260, position: "relative" }}>
        {empty ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#8a94a6",
              fontSize: 13,
            }}
          >
            <span>No emails sent in the {RANGE_LABEL[range].toLowerCase()}.</span>
            <Link href="/emails/new" className="ov-link" style={{ marginTop: 8 }}>
              Send a test email <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorDelivered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f242c" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#6b7280"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis stroke="#6b7280" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomRechartsTooltip />} />
              <Area
                type="monotone"
                dataKey="delivered"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorDelivered)"
              />
              <Area
                type="monotone"
                dataKey="failed"
                stroke="#ef4444"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorFailed)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
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
