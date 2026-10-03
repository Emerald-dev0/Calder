"use client";

import * as React from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  AlertTriangle,
  XCircle,
  Info,
  Sparkles,
  Loader2,
  ChevronRight,
  ExternalLink,
  Ban,
  Send,
} from "lucide-react";
import { useToast } from "./toast";

/* ── Button ──────────────────────────────────────────────────── */
export interface DsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
  iconOnly?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  href?: string;
}

export function DsButton({
  variant = "primary",
  size = "md",
  iconOnly = false,
  loading = false,
  icon,
  leftIcon,
  rightIcon,
  href,
  children,
  className = "",
  disabled,
  ...rest
}: DsButtonProps) {
  const leading = leftIcon ?? icon;
  const classes = [
    "ds-btn",
    `ds-btn-${variant === "accent" ? "primary" : variant}`,
    size === "sm" ? "ds-btn-sm" : size === "lg" ? "ds-btn-lg" : "",
    iconOnly ? "ds-btn-icon" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {leading}
        {children}
        {rightIcon}
      </Link>
    );
  }

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={14} className="ds-spin" /> : leading}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

/* ── Input, Select, Textarea ─────────────────────────────────── */
export interface DsInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  description?: string;
  error?: string | null;
  rightSlot?: React.ReactNode;
}

export function DsInput({
  label,
  hint,
  description,
  error,
  rightSlot,
  id,
  className = "",
  ...rest
}: DsInputProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const helpText = hint ?? description;
  return (
    <div className="ds-field">
      {(label || rightSlot) && (
        <div className="ds-label-row">
          {label && (
            <label htmlFor={inputId} className="ds-label">
              {label}
            </label>
          )}
          {rightSlot}
        </div>
      )}
      <input
        id={inputId}
        className={`ds-input ${error ? "is-error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? (
        <span className="ds-error-text" role="alert">
          <XCircle size={13} /> {error}
        </span>
      ) : (
        helpText && <span className="ds-hint">{helpText}</span>
      )}
    </div>
  );
}

export interface DsSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  description?: string;
  error?: string | null;
}

export function DsSelect({
  label,
  hint,
  description,
  error,
  id,
  children,
  className = "",
  ...rest
}: DsSelectProps) {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  const helpText = hint ?? description;
  return (
    <div className="ds-field">
      {label && (
        <label htmlFor={selectId} className="ds-label">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`ds-select ${error ? "is-error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <span className="ds-error-text" role="alert">
          <XCircle size={13} /> {error}
        </span>
      ) : (
        helpText && <span className="ds-hint">{helpText}</span>
      )}
    </div>
  );
}

export interface DsTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  description?: string;
  error?: string | null;
}

export function DsTextarea({
  label,
  hint,
  description,
  error,
  id,
  className = "",
  ...rest
}: DsTextareaProps) {
  const autoId = React.useId();
  const areaId = id ?? autoId;
  const helpText = hint ?? description;
  return (
    <div className="ds-field">
      {label && (
        <label htmlFor={areaId} className="ds-label">
          {label}
        </label>
      )}
      <textarea
        id={areaId}
        className={`ds-textarea ${error ? "is-error" : ""} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        {...rest}
      />
      {error ? (
        <span className="ds-error-text" role="alert">
          <XCircle size={13} /> {error}
        </span>
      ) : (
        helpText && <span className="ds-hint">{helpText}</span>
      )}
    </div>
  );
}

/* ── Switch & Checkbox & RadioCards ──────────────────────────── */
export function DsSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 36,
          height: 20,
          borderRadius: 999,
          border: "1px solid var(--color-border-strong)",
          background: checked ? "var(--color-accent)" : "var(--color-surface-elevated)",
          padding: 2,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: checked ? "flex-end" : "flex-start",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background-color 150ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "var(--color-surface)",
            boxShadow: "var(--shadow-xs)",
          }}
        />
      </button>
      {(label || description) && (
        <span>
          {label && (
            <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
          )}
          {description && (
            <span style={{ display: "block", fontSize: 12, color: "var(--color-muted)" }}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

export function DsCheckbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--color-accent)", width: 15, height: 15, marginTop: 2 }}
      />
      {(label || description) && (
        <span>
          {label && <span style={{ display: "block", fontWeight: 500 }}>{label}</span>}
          {description && (
            <span style={{ display: "block", fontSize: 12, color: "var(--color-muted)" }}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}

export function DsRadioCards<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (val: T) => void;
  ariaLabel?: string;
  options: Array<{
    value: T;
    title: string;
    description: string;
    badge?: React.ReactNode;
    icon?: React.ReactNode;
  }>;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 10,
      }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: "var(--radius-lg)",
              border: `1px solid ${selected ? "var(--color-ink)" : "var(--color-border-strong)"}`,
              boxShadow: selected ? "inset 0 0 0 1px var(--color-ink)" : "none",
              background: "var(--color-surface)",
              color: "var(--color-ink)",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 13 }}>
                {opt.icon}
                {opt.title}
              </span>
              {opt.badge && (
                <span className="ds-pill mono" style={{ fontSize: 10 }}>
                  {opt.badge}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-muted)", lineHeight: 1.4 }}>
              {opt.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── StatusPill & Badge (Always Icon + Text, Never Color Alone) ─ */
export type StatusKind =
  | "delivered"
  | "verified"
  | "connected"
  | "active"
  | "healthy"
  | "live"
  | "sent"
  | "queued"
  | "sending"
  | "created"
  | "pending"
  | "test"
  | "expired"
  | "bounced"
  | "complained"
  | "failed"
  | "revoked"
  | "disabled"
  | "suppressed"
  | "manual"
  | "bounce"
  | "complaint"
  | "pro";

const STATUS_META: Record<
  string,
  {
    tone: "success" | "warning" | "danger" | "info" | "neutral";
    label: string;
    icon: React.ComponentType<{ size?: number | string }>;
  }
> = {
  delivered: { tone: "success", label: "Delivered", icon: CheckCircle2 },
  verified: { tone: "success", label: "Verified", icon: CheckCircle2 },
  connected: { tone: "success", label: "Connected", icon: CheckCircle2 },
  active: { tone: "success", label: "Active", icon: CheckCircle2 },
  healthy: { tone: "success", label: "Healthy", icon: CheckCircle2 },
  live: { tone: "success", label: "Live", icon: CheckCircle2 },
  sent: { tone: "info", label: "Sent", icon: Send },
  queued: { tone: "warning", label: "Queued", icon: Clock },
  sending: { tone: "info", label: "Sending", icon: Clock },
  created: { tone: "warning", label: "Created", icon: Clock },
  pending: { tone: "warning", label: "Pending", icon: Clock },
  test: { tone: "warning", label: "Test", icon: Clock },
  expired: { tone: "warning", label: "Expired", icon: AlertTriangle },
  bounced: { tone: "danger", label: "Bounced", icon: XCircle },
   bounce: { tone: "danger", label: "Bounce", icon: XCircle },
  complained: { tone: "danger", label: "Complained", icon: AlertTriangle },
  complaint: { tone: "danger", label: "Complaint", icon: AlertTriangle },
  failed: { tone: "danger", label: "Failed", icon: XCircle },
  revoked: { tone: "danger", label: "Revoked", icon: Ban },
  disabled: { tone: "neutral", label: "Disabled", icon: Ban },
  suppressed: { tone: "neutral", label: "Suppressed", icon: Ban },
  manual: { tone: "neutral", label: "Manual block", icon: Ban },
  pro: { tone: "info", label: "PRO", icon: Sparkles },
};

export function StatusPill({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const key = status.toLowerCase();
  const meta = STATUS_META[key] ?? {
    tone: "neutral" as const,
    label: status,
    icon: Info,
  };
  const Icon = meta.icon;
  const toneClass =
    meta.tone === "success"
      ? "ds-pill-success"
      : meta.tone === "warning"
        ? "ds-pill-warning"
        : meta.tone === "danger"
          ? "ds-pill-danger"
          : meta.tone === "info"
            ? "ds-pill-info"
            : "";

  return (
    <span className={`ds-pill ${toneClass}`.trim()}>
      <Icon size={12} />
      <span>{label ?? meta.label}</span>
    </span>
  );
}

/* ── CopyField (for API Keys, IDs, DNS Records) ──────────────── */
export function CopyField({
  value,
  label,
  secret = false,
  compact = false,
}: {
  value: string;
  label?: string;
  secret?: boolean;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [revealed, setRevealed] = React.useState(!secret);

  const displayed =
    secret && !revealed
      ? value.length > 12
        ? `${value.slice(0, 10)}${"•".repeat(16)}`
        : "••••••••••••••••"
      : value;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({
        title: label ? `Copied ${label}` : "Copied to clipboard",
        description: secret ? "Secret copied to clipboard." : value.slice(0, 64),
        tone: "success",
      });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div
      className="ds-copy-field"
      style={compact ? { padding: "3px 6px 3px 9px", fontSize: 11.5 } : undefined}
    >
      {label && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-muted)",
            marginRight: 4,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
      )}
      <span className="ds-copy-field-value" title={revealed ? value : "Hidden secret"}>
        {displayed}
      </span>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="ds-btn ds-btn-ghost ds-btn-sm ds-btn-icon"
            aria-label={revealed ? "Hide secret" : "Reveal secret"}
            title={revealed ? "Hide secret" : "Reveal secret"}
            style={{ width: 26, height: 26 }}
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="ds-btn ds-btn-secondary ds-btn-sm"
          style={{ height: 26, padding: "0 8px", fontSize: 11 }}
          aria-label={label ? `Copy ${label}` : "Copy value"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

/* ── CodeBlock with Language Tabs & Copy ─────────────────────── */
export function CodeBlock({
  tabs,
  code,
  filename,
  title,
}: {
  tabs?: Array<{ id: string; label: string; filename?: string; code: string }>;
  code?: string;
  filename?: string;
  title?: string;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = React.useState(tabs?.[0]?.id ?? "default");
  const [copied, setCopied] = React.useState(false);

  const current = tabs ? tabs.find((t) => t.id === activeTab) ?? tabs[0] : null;
  const activeCode = current ? current.code : (code ?? "");
  const activeFilename = current?.filename ?? filename ?? title;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      toast({
        title: "Snippet copied",
        description: activeFilename ?? "Copied to clipboard.",
        tone: "success",
      });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  }

  return (
    <div className="ds-code-block">
      <div className="ds-code-header">
        <div className="ds-code-tabs" role={tabs ? "tablist" : undefined}>
          {tabs ? (
            tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === activeTab}
                onClick={() => setActiveTab(t.id)}
                className={`ds-code-tab ${t.id === activeTab ? "is-active" : ""}`}
              >
                {t.label}
              </button>
            ))
          ) : (
            <span className="mono" style={{ fontSize: 11.5, color: "rgba(232,233,234,0.7)" }}>
              {activeFilename ?? "snippet"}
            </span>
          )}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {tabs && activeFilename && (
            <span className="mono" style={{ fontSize: 11, color: "rgba(232,233,234,0.55)" }}>
              {activeFilename}
            </span>
          )}
          <button
            type="button"
            onClick={() => void copyCode()}
            className="ds-code-tab is-active"
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <pre className="ds-code-pre">{activeCode}</pre>
    </div>
  );
}

/* ── Banner / Callout ────────────────────────────────────────── */
export function DsBanner({
  tone = "info",
  title,
  description,
  action,
}: {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? AlertTriangle
        : tone === "danger"
          ? XCircle
          : Info;
  const toneColor =
    tone === "success"
      ? "var(--color-success)"
      : tone === "warning"
        ? "var(--color-warning)"
        : tone === "danger"
          ? "var(--color-danger)"
          : "var(--color-accent)";

  return (
    <div className={`ds-banner ${tone !== "neutral" ? `ds-banner-${tone}` : ""}`}>
      <div className="ds-banner-left">
        <span style={{ color: toneColor, flexShrink: 0, marginTop: 2 }}>
          <Icon size={17} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--color-ink)" }}>{title}</div>
          {description && (
            <div style={{ color: "var(--color-ink-secondary)", marginTop: 2, fontSize: 12.5 }}>
              {description}
            </div>
          )}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

/* ── StatCard / MetricCard ───────────────────────────────────── */
export function StatCard({
  label,
  value,
  sub,
  sublabel,
  delta,
  icon,
  status,
}: {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  sublabel?: React.ReactNode;
  delta?: { value: string; positive?: boolean };
  icon?: React.ReactNode;
  status?: string;
}) {
  const footer = sub ?? sublabel;
  return (
    <div className="ds-stat-card">
      <div className="ds-stat-top">
        <span className="ds-stat-label">{label}</span>
        {icon && <span className="ds-stat-icon">{icon}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p className="ds-stat-value">{value}</p>
        {status && <StatusPill status={status} />}
        {delta && (
          <span
            className="mono tabular-nums"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: delta.positive ? "var(--color-success)" : "var(--color-warning)",
            }}
          >
            {delta.value}
          </span>
        )}
      </div>
      {footer && <div className="ds-stat-sub">{footer}</div>}
    </div>
  );
}

/* ── KeyValueList ────────────────────────────────────────────── */
export function KeyValueList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode; copyValue?: string; mono?: boolean }>;
}) {
  return (
    <dl style={{ margin: 0, display: "flex", flexDirection: "column" }}>
      {items.map((item, idx) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "9px 0",
            borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
            fontSize: 13,
          }}
        >
          <dt style={{ color: "var(--color-muted)", fontSize: 12, fontWeight: 500 }}>
            {item.label}
          </dt>
          <dd
            className={item.mono ? "mono" : ""}
            style={{
              margin: 0,
              color: "var(--color-ink)",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            {item.copyValue ? (
              <CopyField value={item.copyValue} compact />
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── EmptyState (Icon + 1-Sentence Teaching Copy + CTA + Docs) ─ */
export function DsEmptyState({
  icon,
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  primaryAction,
  secondaryAction,
  docsHref = "https://calder.click/docs",
  docsLabel = "Read documentation",
}: {
  icon?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  docsHref?: string;
  docsLabel?: string;
}) {
  return (
    <div className="ds-empty-state">
      {icon && <div className="ds-empty-icon">{icon}</div>}
      {eyebrow && (
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-muted)",
          }}
        >
          {eyebrow}
        </span>
      )}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--color-ink)" }}>
        {title}
      </h3>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.55,
          color: "var(--color-muted)",
          maxWidth: 460,
        }}
      >
        {description}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
        {primaryAction}
        {actionLabel && actionHref && (
          <DsButton variant="primary" href={actionHref}>
            {actionLabel}
          </DsButton>
        )}
        {actionLabel && onAction && !actionHref && (
          <DsButton variant="primary" onClick={onAction}>
            {actionLabel}
          </DsButton>
        )}
        {secondaryAction}
        {!secondaryAction && docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noreferrer"
            className="ds-btn ds-btn-secondary"
          >
            <span>{docsLabel}</span>
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </div>
  );
}

/* ── PageHeader ──────────────────────────────────────────────── */
export function DsPageHeader({
  icon,
  title,
  description,
  badge,
  actions,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header-left">
        {icon && <div className="ds-page-icon">{icon}</div>}
        <div style={{ minWidth: 0 }}>
          <div className="ds-page-title-row">
            <h1 className="ds-page-title">{title}</h1>
            {badge}
          </div>
          {description && <p className="ds-page-desc">{description}</p>}
        </div>
      </div>
      {actions && <div className="ds-page-actions">{actions}</div>}
    </header>
  );
}

/* ── Breadcrumbs, Avatar, Kbd, Tooltip, Skeleton ─────────────── */
export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, minWidth: 0 }}>
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}_${idx}`}>
            {idx > 0 && <ChevronRight size={13} style={{ color: "var(--color-subtle)", flexShrink: 0 }} />}
            {item.href && !last ? (
              <Link
                href={item.href}
                style={{
                  color: "var(--color-muted)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </Link>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                style={{
                  color: last ? "var(--color-ink)" : "var(--color-muted)",
                  fontWeight: last ? 600 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export function Avatar({
  name,
  email,
  size = 28,
}: {
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const source = (name || email || "C").trim();
  const initials = source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--color-accent)",
        color: "var(--color-surface)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials || "C"}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ds-kbd">{children}</kbd>;
}

export function DsSkeleton({
  width = "100%",
  height = 18,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="ds-skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}
