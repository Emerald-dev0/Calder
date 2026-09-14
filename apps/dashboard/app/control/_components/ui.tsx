import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDelta, fmtInt } from "@/lib/control/format";

/* Shared Control Plane primitives — server-safe, zero client JS. */

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
    <header className="cp-head cp-head-row">
      <div style={{ minWidth: 0 }}>
        <p className="cp-eyebrow">{eyebrow}</p>
        <h1 className="cp-title">{title}</h1>
        {subtitle ? <p className="cp-subtitle">{subtitle}</p> : null}
      </div>
      {right ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div> : null}
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
    <section className="cp-panel">
      {title ? (
        <div className="cp-panel-head">
          <div>
            <h2 className="cp-panel-title">{title}</h2>
            {caption ? <p className="cp-panel-caption">{caption}</p> : null}
          </div>
          {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
        </div>
      ) : null}
      <div className={`cp-panel-body${flush ? " cp-flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  invertDelta,
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  hint?: string;
  invertDelta?: boolean;
}) {
  const good = delta === null || delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0;
  return (
    <div className="cp-stat">
      <p className="cp-stat-label">{label}</p>
      <p className="cp-stat-value">{value}</p>
      {delta !== null && delta !== undefined ? (
        <p className="cp-stat-foot">
          <span className={good ? "cp-delta-up" : "cp-delta-down"}>{fmtDelta(delta)}</span>
          {hint ? <span>{hint}</span> : null}
        </p>
      ) : hint ? (
        <p className="cp-stat-foot">{hint}</p>
      ) : null}
    </div>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "info" | "idle" }) {
  return <span className={`cp-dot ${tone}`} aria-hidden />;
}

export function Badge({
  tone,
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "accent" | "info";
  children: ReactNode;
}) {
  return <span className={`cp-badge ${tone === "info" ? "accent" : tone ?? ""}`}>{children}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="cp-tag">{children}</span>;
}

export function KV({ k, v, mono, hint }: { k: string; v: ReactNode; mono?: boolean; hint?: ReactNode }) {
  return (
    <div className="cp-kv">
      <span className="k">
        {k}
        {hint ? <span style={{ color: "var(--cp-faint)", marginLeft: 6, fontSize: 11.5 }}>{hint}</span> : null}
      </span>
      <span className={`v${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="cp-empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Planned({
  title,
  children,
  bullets,
}: {
  title: string;
  children: ReactNode;
  bullets?: string[];
}) {
  return (
    <div className="cp-planned">
      <b>{title}</b>
      <p>{children}</p>
      {bullets?.length ? (
        <ul>
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
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
    <div className="cp-barlist">
      {items.map((i) => (
        <div className="cp-barrow" key={i.label}>
          <span className="cp-bar-label">
            {i.href ? (
              <Link href={i.href} style={{ color: "inherit" }}>
                {i.label}
              </Link>
            ) : (
              i.label
            )}
          </span>
          <span className="cp-bartrack">
            <span
              className={`cp-barfill${i.dim || showOtherTone ? " dim" : ""}`}
              style={{ width: `${Math.max(2, (i.count / top) * 100)}%` }}
            />
          </span>
          <span className="cp-barvalue">{fmtInt(i.count)}</span>
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
    <nav className="cp-tabs" aria-label="Time range">
      {RANGE_KEYS.map((r) => (
        <Link key={r} className="cp-tab" data-active={current === r} href={params(r)}>
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
    <div className="cp-pager">
      <span>
        {fmtInt(total)} total · page {page} / {pages}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {page > 1 ? (
          <Link href={link(page - 1)}>
            ← Prev
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={link(page + 1)}>
            Next →
          </Link>
        ) : null}
      </span>
    </div>
  );
}
