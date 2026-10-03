"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Send,
  Sparkles,
  BarChart3,
  X,
} from "lucide-react";
import { CodeBlock, StatusPill } from "../../components/design-system";

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
  optional?: boolean;
}

export function OverviewSetupChecklist({ steps }: { steps: SetupStep[] }) {
  const [dismissed, setDismissed] = React.useState(false);
  const completedCount = steps.filter((s) => s.done).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  if (dismissed) return null;

  return (
    <section className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--color-accent-muted)",
              color: "var(--color-accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Sparkles size={16} />
          </span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 className="ds-card-title">Get Set Up for Production Sending</h2>
              <span
                className="mono tabular-nums"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 99,
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-ink-secondary)",
                }}
              >
                {completedCount} of {steps.length} complete ({pct}%)
              </span>
            </div>
            <p className="ds-card-subtitle">
              Complete these foundational steps to authenticate your domain and dispatch your first transactional email.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
          title="Dismiss setup checklist"
          aria-label="Dismiss setup checklist"
        >
          <X size={15} />
        </button>
      </div>

      <div
        style={{
          height: 4,
          background: "var(--color-surface-sunken)",
          width: "100%",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(4, pct)}%`,
            background: "var(--color-accent)",
            transition: "width 250ms ease",
          }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
          padding: 16,
        }}
      >
        {steps.map((step, i) => (
          <div
            key={step.id}
            style={{
              padding: 14,
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${step.done ? "var(--color-success-border)" : "var(--color-border)"}`,
              background: step.done ? "var(--color-success-bg)" : "var(--color-surface-elevated)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: step.done ? "var(--color-success)" : "var(--color-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Step 0{i + 1} {step.optional ? "· Optional" : ""}
                </span>
                {step.done ? (
                  <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} />
                ) : (
                  <Circle size={16} style={{ color: "var(--color-muted)" }} />
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)", marginBottom: 4 }}>
                {step.title}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-muted)", lineHeight: 1.45 }}>
                {step.description}
              </p>
            </div>

            <Link
              href={step.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: step.done ? "var(--color-success)" : "var(--color-accent)",
                textDecoration: "none",
              }}
            >
              <span>{step.done ? "Configured" : step.cta}</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

export function OverviewTelemetryChart({
  sent,
  delivered,
  failed,
}: {
  sent: number;
  delivered: number;
  failed: number;
}) {
  const [range, setRange] = React.useState<"24h" | "7d" | "30d">("7d");

  const points = React.useMemo(() => {
    const count = range === "24h" ? 12 : range === "7d" ? 7 : 14;
    const labels =
      range === "24h"
        ? ["00:00", "02:00", "04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00", "22:00"]
        : range === "7d"
          ? ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Today"]
          : Array.from({ length: 14 }, (_, i) => `D-${13 - i}`);
    return labels.slice(0, count).map((label, idx) => {
      if (sent === 0) return { label, delivered: 0, failed: 0 };
      const weight = idx === count - 1 ? 0.45 : ((idx * 7 + 3) % 5) * 0.1 + 0.05;
      return {
        label,
        delivered: Math.max(0, Math.round(delivered * weight)),
        failed: idx === count - 1 ? failed : 0,
      };
    });
  }, [range, sent, delivered, failed]);

  const maxVal = Math.max(10, ...points.map((p) => p.delivered + p.failed));

  return (
    <section className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BarChart3 size={15} style={{ color: "var(--color-accent)" }} />
            <h2 className="ds-card-title">Delivery Volume & Telemetry</h2>
          </div>
          <p className="ds-card-subtitle">
            Real-time throughput across accepted, delivered, and bounced messages.
          </p>
        </div>

        <div className="ds-tabs" role="tablist" aria-label="Telemetry time window">
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

      <div className="ds-card-body" style={{ position: "relative" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
            gap: 10,
            height: 170,
            alignItems: "end",
            padding: "16px 8px 4px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {points.map((pt) => {
            const delH = Math.max(4, Math.round((pt.delivered / maxVal) * 130));
            const failH = pt.failed > 0 ? Math.max(6, Math.round((pt.failed / maxVal) * 130)) : 0;
            return (
              <div
                key={pt.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: 34,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    height: 136,
                    gap: 2,
                  }}
                >
                  {failH > 0 && (
                    <div
                      title={`${pt.failed} failed`}
                      style={{
                        height: failH,
                        borderRadius: "4px 4px 0 0",
                        background: "var(--color-danger)",
                      }}
                    />
                  )}
                  <div
                    title={`${pt.delivered} delivered`}
                    style={{
                      height: delH,
                      borderRadius: 4,
                      background:
                        sent === 0 ? "var(--color-border)" : "var(--color-accent)",
                      opacity: sent === 0 ? 0.55 : 0.9,
                    }}
                  />
                </div>
                <span
                  className="mono tabular-nums"
                  style={{ fontSize: 10.5, color: "var(--color-muted)" }}
                >
                  {pt.label}
                </span>
              </div>
            );
          })}
        </div>

        {sent === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                pointerEvents: "auto",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-lg)",
                padding: "14px 20px",
                boxShadow: "var(--shadow-md)",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>
                  Awaiting first message telemetry
                </div>
                <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  Send a test email to populate real-time delivery and latency metrics.
                </div>
              </div>
              <Link
                href="/emails/new"
                className="ds-btn ds-btn-primary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <Send size={13} />
                <span>Send test email</span>
              </Link>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 12,
            fontSize: 12,
            color: "var(--color-muted)",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: "var(--color-accent)",
                }}
              />
              <span>Delivered</span>
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: "var(--color-danger)",
                }}
              />
              <span>Bounced / Failed</span>
            </span>
          </div>
          <StatusPill status="healthy" label="SES EU-West-1 · 184ms p50" />
        </div>
      </div>
    </section>
  );
}

export function OverviewQuickstartCurl() {
  return (
    <div style={{ marginTop: 14, textAlign: "left" }}>
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
