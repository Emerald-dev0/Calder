import Link from "next/link";
import React from "react";
import { Inbox, ArrowRight, Sparkles } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  illustration?: "narrative" | "abstract";
  icon?: React.ReactNode;
  secondaryLabel?: string;
  secondaryHref?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  illustration = "narrative",
  icon,
  secondaryLabel,
  secondaryHref,
}: EmptyStateProps) {
  return (
    <div className="ds-empty" style={{ margin: "12px 0" }}>
      <div className="ds-empty-icon">
        {icon ?? (illustration === "abstract" ? <Sparkles size={22} /> : <Inbox size={22} />)}
      </div>

      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          margin: "0 0 6px",
          letterSpacing: "-0.015em",
          color: "var(--color-ink)",
        }}
      >
        {title}
      </h3>

      <p
        style={{
          color: "var(--color-muted)",
          fontSize: 13.5,
          lineHeight: 1.55,
          margin: "0 0 20px",
          maxWidth: 420,
        }}
      >
        {description}
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        {actionLabel && actionHref && (
          <Link
            href={actionHref}
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            <span>{actionLabel}</span>
            <ArrowRight size={14} />
          </Link>
        )}

        {actionLabel && onAction && !actionHref && (
          <button
            type="button"
            onClick={onAction}
            className="ds-btn ds-btn-primary"
          >
            <span>{actionLabel}</span>
            <ArrowRight size={14} />
          </button>
        )}

        {secondaryLabel && secondaryHref && (
          <Link
            href={secondaryHref}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <span>{secondaryLabel}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
