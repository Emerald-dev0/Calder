"use client";

import * as React from "react";
import { X, AlertTriangle, Sparkles, Check, ExternalLink } from "lucide-react";
import { DsButton, Kbd } from "./primitives";
import { pricingUrl } from "../../lib/pricing";

export function DsDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 500,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ds-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ds-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth }}
      >
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title" style={{ fontSize: 15 }}>
              {title}
            </h2>
            {description && <p className="ds-card-subtitle">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ds-card-body" style={{ overflowY: "auto" }}>
          {children}
        </div>
        {footer && <div className="ds-card-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  confirmPhrase,
  danger = true,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmPhrase?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const canConfirm = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <DsDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <DsButton variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </DsButton>
          <DsButton
            variant={danger ? "danger" : "primary"}
            onClick={() => void onConfirm()}
            disabled={!canConfirm || busy}
            loading={busy}
          >
            {confirmLabel}
          </DsButton>
        </>
      }
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {danger && (
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--color-danger-bg)",
              color: "var(--color-danger)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={17} />
          </span>
        )}
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--color-ink-secondary)" }}>
            {description}
          </p>
          {confirmPhrase && (
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--color-muted)", marginBottom: 6 }}>
                Type <b className="mono" style={{ color: "var(--color-ink)" }}>{confirmPhrase}</b> to confirm:
              </label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
                className="ds-input mono"
              />
            </div>
          )}
        </div>
      </div>
    </DsDialog>
  );
}

export function DsDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ds-drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="ds-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ds-drawer-header">
          <div style={{ minWidth: 0 }}>
            <h2 className="ds-card-title" style={{ fontSize: 15 }}>
              {title}
            </h2>
            {subtitle && <div className="ds-card-subtitle">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm"
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="ds-drawer-body">{children}</div>
        {footer && <div className="ds-card-footer">{footer}</div>}
      </aside>
    </div>
  );
}

export function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const shortcuts = [
    { keys: ["⌘", "K"], label: "Open command palette & search" },
    { keys: ["?"], label: "Show keyboard shortcuts" },
    { keys: ["G", "O"], label: "Go to Overview" },
    { keys: ["G", "E"], label: "Go to Messages & Logs" },
    { keys: ["G", "D"], label: "Go to Domains" },
    { keys: ["G", "K"], label: "Go to API Keys" },
    { keys: ["C"], label: "Compose test email" },
    { keys: ["Esc"], label: "Close active dialog or drawer" },
  ];

  return (
    <DsDialog
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      description="Navigate and operate Calder without leaving the keyboard."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shortcuts.map((s) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--color-ink-secondary)" }}>{s.label}</span>
            <span style={{ display: "inline-flex", gap: 4 }}>
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </DsDialog>
  );
}

export function ProUpgradeModal({
  open,
  onClose,
  featureTitle = "Calder Pro Infrastructure",
  featureDescription = "Unlock higher monthly volume, dedicated inbound routing, and granular delivery analytics.",
}: {
  open: boolean;
  onClose: () => void;
  featureTitle?: string;
  featureDescription?: string;
}) {
  const perks = [
    "50,000+ monthly emails with priority SES throughput",
    "Inbound email routing & parsed webhook payloads (Inbox)",
    "Advanced domain, sender, and open/click analytics",
    "Extended log retention and priority engineering support",
  ];

  return (
    <DsDialog
      open={open}
      onClose={onClose}
      title={featureTitle}
      description="Available on the Calder Pro plan"
      footer={
        <>
          <DsButton variant="secondary" onClick={onClose}>
            Keep exploring
          </DsButton>
          <a
            href={pricingUrl()}
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            <Sparkles size={14} />
            <span>Upgrade to Pro</span>
            <ExternalLink size={13} />
          </a>
        </>
      }
    >
      <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.55, color: "var(--color-ink-secondary)" }}>
        {featureDescription}
      </p>
      <div
        style={{
          background: "var(--color-surface-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {perks.map((p) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "var(--color-accent)", flexShrink: 0 }}>
              <Check size={15} />
            </span>
            <span>{p}</span>
          </div>
        ))}
      </div>
    </DsDialog>
  );
}
