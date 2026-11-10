import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDelta, fmtInt } from "@/lib/control/format";
import { Sparkline } from "./charts";

/* Control Plane primitives mapped onto the dashboard design system
   (`ds-*`/shell classes) for a unified look. Server-safe, zero client JS. */

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="ds-page-header cp-page-header">
      <div className="ds-page-header-left">
        <div style={{ minWidth: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-muted)",
              marginBottom: 6,
            }}
          >
            {eyebrow}
          </div>
          <div className="ds-page-title-row">
            <h1 className="ds-page-title">{title}</h1>
          </div>
          {subtitle ? <p className="ds-page-desc">{subtitle}</p> : null}
        </div>
      </div>
      {right ? <div className="ds-page-actions">{right}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  caption,
  action,
  flush,
  children,
}: {
  title?: string;
  caption?: string;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ds-card cp-panel">
      {title ? (
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">{title}</h2>
            {caption ? <p className="ds-card-subtitle">{caption}</p> : null}
          </div>
          {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "" : "ds-card-body"}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  invertDelta,
  basis,
  spark,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: string;
  invertDelta?: boolean;
  basis?: string;
  spark?: number[];
}) {
  const good = delta === null || delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0;
  return (
    <div className="ds-stat-card cp-stat">
      <div className="ds-stat-top">
        <span className="ds-stat-label">{label}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <p className="ds-stat-value">{value}</p>
      </div>
      {spark && spark.length > 1 ? <Sparkline data={spark} width={130} height={26} /> : null}
      {delta !== null && delta !== undefined ? (
        <div className="ds-stat-sub">
          <span
            className="mono tabular-nums"
            style={{
              fontWeight: 600,
              color: good ? "var(--color-success)" : "var(--color-warning)",
            }}
          >
            {fmtDelta(delta)}
          </span>
          {basis || hint ? <span>{basis ?? hint}</span> : null}
        </div>
      ) : hint ? (
        <div className="ds-stat-sub">{hint}</div>
      ) : null}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      className="cp-section-label"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        margin: "24px 0 10px",
        flexWrap: "wrap",
      }}
    >
      <p
        className="mono"
        style={{
          margin: 0,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-muted)",
        }}
      >
        {children}
      </p>
      {right ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div> : null}
    </div>
  );
}

export function InsightList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      {items.map((t, i) => (
        <p
          key={i}
          style={{
            margin: 0,
            padding: "10px 16px",
            borderBottom: i === items.length - 1 ? "none" : "1px solid var(--color-border)",
            fontSize: 13,
            color: "var(--color-muted)",
          }}
        >
          {t}
        </p>
      ))}
    </div>
  );
}

export function SkeletonStat({ count = 4 }: { count?: number }) {
  return (
    <div className="cp-stats">
      {Array.from({ length: count }).map((_, i) => (
        <div className="ds-stat-card" key={i}>
          <span
            className="ds-skeleton"
            style={{ width: 64, height: 10, display: "block", marginBottom: 12 }}
          />
          <span className="ds-skeleton" style={{ width: 96, height: 24, display: "block" }} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonBlock({ height = 190 }: { height?: number }) {
  return <span className="ds-skeleton" style={{ width: "100%", height, display: "block" }} />;
}

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "info" | "idle" }) {
  const color =
    tone === "ok"
      ? "var(--color-success)"
      : tone === "warn"
        ? "var(--color-warning)"
        : tone === "bad"
          ? "var(--color-danger)"
          : tone === "info"
            ? "var(--color-accent)"
            : "var(--color-subtle)";
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        display: "inline-block",
        flexShrink: 0,
        background: color,
      }}
    />
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "accent" | "info";
  children: ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "ds-pill-success"
      : tone === "warn"
        ? "ds-pill-warning"
        : tone === "bad"
          ? "ds-pill-danger"
          : tone === "accent" || tone === "info"
            ? "ds-pill-info"
            : "";
  return <span className={`ds-pill ${cls}`.trim()}>{children}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="ds-pill">{children}</span>;
}

export function KV({
  k,
  v,
  mono,
  hint,
}: {
  k: string;
  v: ReactNode;
  mono?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "9px 0",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--color-muted)", fontSize: 12, fontWeight: 500 }}>
        {k}
        {hint ? <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>{hint}</span> : null}
      </span>
      <span
        className={mono ? "mono" : ""}
        style={{ fontWeight: 600, textAlign: "right", minWidth: 0 }}
      >
        {v}
      </span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ds-empty">
      <div style={{ fontWeight: 700, color: "var(--color-ink)", fontSize: 14 }}>{title}</div>
      {children ? (
        <div style={{ fontSize: 13, color: "var(--color-muted)", maxWidth: 520 }}>{children}</div>
      ) : null}
    </div>
  );
}

export function Planned({
  title,
  children,
  bullets,
  state = "planned",
}: {
  title: string;
  children: ReactNode;
  bullets?: string[];
  state?: "planned" | "gated" | "disabled";
}) {
  const label = state === "gated" ? "Gated" : state === "disabled" ? "Disabled" : "Not enabled";
  return (
    <div
      className="ds-card"
      style={{ borderStyle: "dashed", background: "var(--color-surface-elevated)" }}
    >
      <div className="ds-card-body">
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-muted)",
            marginBottom: 6,
          }}
        >
          {label}
        </div>
        <div style={{ fontWeight: 700, color: "var(--color-ink)", fontSize: 14 }}>{title}</div>
        <p
          style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-muted)", lineHeight: 1.55 }}
        >
          {children}
        </p>
        {bullets?.length ? (
          <ul
            style={{
              margin: "10px 0 0",
              paddingLeft: 18,
              fontSize: 12.5,
              color: "var(--color-muted)",
            }}
          >
            {bullets.map((b) => (
              <li key={b} style={{ padding: "2px 0" }}>
                {b}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function BarList({
  items,
  max,
  showOtherTone,
}: {
  items: Array<{ label: string; count: number; href?: string; dim?: boolean }>;
  max?: number;
  showOtherTone?: boolean;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.count));
  if (items.length === 0) return <Empty title="No data yet" />;
  return (
    <div style={{ padding: "8px 0" }}>
      {items.map((i) => (
        <div
          key={i.label}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(90px,160px) 1fr minmax(56px,auto)",
            alignItems: "center",
            gap: 12,
            padding: "6px 16px",
            fontSize: 13,
          }}
        >
          <span
            style={{
              color: "var(--color-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {i.href ? (
              <Link href={i.href} style={{ color: "inherit" }}>
                {i.label}
              </Link>
            ) : (
              i.label
            )}
          </span>
          <span
            style={{
              display: "block",
              height: 6,
              borderRadius: 999,
              background: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                borderRadius: 999,
                background: i.dim || showOtherTone ? "var(--color-subtle)" : "var(--color-accent)",
                opacity: i.dim || showOtherTone ? 0.45 : 0.7,
                width: `${Math.max(2, (i.count / top) * 100)}%`,
              }}
            />
          </span>
          <span className="mono tabular-nums" style={{ textAlign: "right", fontSize: 12.5 }}>
            {fmtInt(i.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

const RANGE_KEYS = ["7d", "30d", "90d", "6m", "1y", "all"] as const;

export function RangeTabs({
  current,
  basePath,
  query = {},
}: {
  current: string;
  basePath: string;
  query?: Record<string, string | undefined>;
}) {
  const params = (range: string) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    sp.set("range", range);
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <nav className="ds-tabs" aria-label="Time range">
      {RANGE_KEYS.map((r) => (
        <Link key={r} className={`ds-tab ${current === r ? "is-active" : ""}`} href={params(r)}>
          {r === "all" ? "ALL" : r.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}

export function Pager({
  page,
  pages,
  total,
  query,
  basePath,
}: {
  page: number;
  pages: number;
  total: number;
  query: Record<string, string | undefined>;
  basePath: string;
}) {
  const link = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "10px 16px",
        fontSize: 12,
        color: "var(--color-muted)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <span>
        {fmtInt(total)} total · page {page} / {pages}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {page > 1 ? (
          <Link className="ds-btn ds-btn-secondary ds-btn-sm" href={link(page - 1)}>
            ← Prev
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="ds-btn ds-btn-secondary ds-btn-sm" href={link(page + 1)}>
            Next →
          </Link>
        ) : null}
      </span>
    </div>
  );
}
