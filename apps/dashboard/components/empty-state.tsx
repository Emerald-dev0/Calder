import Image from "next/image";
import Link from "next/link";
import React from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  illustration?: "narrative" | "abstract";
}

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  illustration = "narrative",
}: EmptyStateProps) {
  const imgSrc =
    illustration === "abstract"
      ? "/illustrations/empty-state-abstract.svg"
      : "/illustrations/empty-state-narrative.webp";

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "48px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        margin: "12px 0",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 140,
          height: 96,
          marginBottom: 16,
          opacity: 0.9,
        }}
      >
        <Image
          src={imgSrc}
          alt=""
          fill
          sizes="140px"
          style={{ objectFit: "contain" }}
          priority={false}
        />
      </div>

      <h3
        style={{
          fontSize: 17,
          fontWeight: 700,
          margin: "0 0 6px",
          letterSpacing: "-0.01em",
          color: "var(--color-ink)",
        }}
      >
        {title}
      </h3>

      <p
        style={{
          color: "var(--color-muted)",
          fontSize: 14,
          lineHeight: 1.5,
          margin: "0 0 20px",
          maxWidth: 380,
        }}
      >
        {description}
      </p>

      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          style={{
            display: "inline-block",
            background: "var(--color-ink)",
            color: "#ffffff",
            padding: "8px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          {actionLabel}
        </Link>
      )}

      {actionLabel && onAction && !actionHref && (
        <button
          type="button"
          onClick={onAction}
          style={{
            background: "var(--color-ink)",
            color: "#ffffff",
            border: "none",
            padding: "8px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
