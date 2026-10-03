import Link from "next/link";
import { Sparkles, Check, ExternalLink, Lock, ArrowRight } from "lucide-react";
import { pricingUrl } from "../lib/pricing";

type Tier = "PRO" | "PREMIUM" | "SCALE";

interface PlanGateProps {
  title: string;
  description: string;
  tier: Tier;
  features?: string[];
  preview?: React.ReactNode;
}

const tierLabel: Record<Tier, string> = {
  PRO: "Available on Pro",
  PREMIUM: "Available on Premium",
  SCALE: "Available on Scale",
};

const tierCTA: Record<Tier, string> = {
  PRO: "Upgrade to Pro",
  PREMIUM: "Upgrade to Premium",
  SCALE: "Talk to Calder",
};

export function PlanGate({ title, description, tier, features, preview }: PlanGateProps) {
  return (
    <div
      className="ds-card"
      style={{
        padding: "36px 28px",
        textAlign: "center",
        margin: "12px 0",
        background: "var(--color-surface)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: "var(--radius-full)",
          background: "var(--color-accent-muted)",
          color: "var(--color-accent)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        <Sparkles size={12} />
        <span>{tierLabel[tier]}</span>
      </div>

      <h3
        style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          margin: "0 0 8px",
          color: "var(--color-ink)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          color: "var(--color-muted)",
          fontSize: 13.5,
          lineHeight: 1.6,
          maxWidth: 480,
          margin: "0 auto 20px",
        }}
      >
        {description}
      </p>

      {features && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            maxWidth: 560,
            margin: "0 auto 24px",
            textAlign: "left",
            padding: 16,
            borderRadius: "var(--radius-lg)",
            background: "var(--color-surface-elevated)",
            border: "1px solid var(--color-border)",
          }}
        >
          {features.map((f) => (
            <div
              key={f}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12.5,
                color: "var(--color-ink-secondary)",
                lineHeight: 1.45,
              }}
            >
              <span
                style={{
                  color: "var(--color-success)",
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                <Check size={14} />
              </span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          style={{
            opacity: 0.72,
            pointerEvents: "none",
            margin: "0 auto 24px",
            maxWidth: 640,
            borderRadius: "var(--radius-lg)",
            border: "1px dashed var(--color-border-strong)",
            padding: 14,
            background: "var(--color-surface-elevated)",
          }}
        >
          {preview}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <a
          href={pricingUrl()}
          className="ds-btn ds-btn-primary"
          style={{ textDecoration: "none" }}
        >
          <Sparkles size={14} />
          <span>{tierCTA[tier]}</span>
          <ExternalLink size={13} />
        </a>
        <a
          href={pricingUrl()}
          className="ds-btn ds-btn-secondary"
          style={{ textDecoration: "none" }}
        >
          <span>Compare plans</span>
        </a>
      </div>
    </div>
  );
}

export function PlanBadge({ tier }: { tier: Tier }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "1px 6px",
        borderRadius: 4,
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-border)",
        color: "var(--color-muted)",
      }}
    >
      {tier}
    </span>
  );
}

export function LimitState({
  title,
  description,
  used,
  limit,
  tier,
}: {
  title: string;
  description: string;
  used: number;
  limit: number;
  tier: Tier;
}) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div
      className="ds-card"
      style={{
        padding: "32px 24px",
        textAlign: "center",
        margin: "12px 0",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "var(--color-warning-bg)",
          color: "var(--color-warning)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <Lock size={18} />
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 6px", color: "var(--color-ink)" }}>
        {title}
      </h3>
      <p style={{ color: "var(--color-muted)", fontSize: 13.5, margin: "0 0 14px" }}>
        {description}
      </p>
      <div
        className="mono tabular-nums"
        style={{ fontSize: 12, color: "var(--color-ink-secondary)", marginBottom: 10 }}
      >
        {used.toLocaleString()} / {limit.toLocaleString()} used ({pct}%)
      </div>
      <div
        style={{
          height: 6,
          background: "var(--color-surface-sunken)",
          borderRadius: 99,
          overflow: "hidden",
          maxWidth: 320,
          margin: "0 auto 18px",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct >= 90 ? "var(--color-danger)" : "var(--color-accent)",
          }}
        />
      </div>
      <a
        href={pricingUrl()}
        className="ds-btn ds-btn-primary"
        style={{ textDecoration: "none" }}
      >
        <Sparkles size={14} />
        <span>{tierCTA[tier]}</span>
      </a>
    </div>
  );
}

export function SetupState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div
      className="ds-card"
      style={{
        padding: "32px 24px",
        textAlign: "center",
        margin: "12px 0",
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "var(--color-ink)" }}>
        {title}
      </h3>
      <p
        style={{
          color: "var(--color-muted)",
          fontSize: 13.5,
          lineHeight: 1.55,
          maxWidth: 400,
          margin: "0 auto 16px",
        }}
      >
        {description}
      </p>
      <Link
        href={actionHref}
        className="ds-btn ds-btn-primary"
        style={{ textDecoration: "none" }}
      >
        <span>{actionLabel}</span>
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
