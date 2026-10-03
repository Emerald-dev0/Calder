"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalderLockup } from "@calder/ui";
import { Compass, ArrowLeft, Mail } from "lucide-react";
import { StatusPill } from "../components/design-system";

/**
 * Plain-English 404: say what happened, show the missing address,
 * offer the way out. Uses design tokens in both Light and Dark mode.
 */
export default function NotFound() {
  const pathname = usePathname();
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        background: "var(--color-bg)",
        color: "var(--color-ink)",
        textAlign: "center",
      }}
    >
      <div className="ds-card" style={{ maxWidth: 480, width: "100%", padding: "36px 28px" }}>
        <div style={{ margin: "0 0 20px", display: "flex", justifyContent: "center" }}>
          <CalderLockup size={22} />
        </div>

        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "var(--color-warning-bg)",
            color: "var(--color-warning)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <Compass size={24} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <StatusPill status="pending" label="404 · Page not found" />
        </div>

        <h1
          style={{
            fontSize: "clamp(22px, 4vw, 26px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: "0 0 10px",
            lineHeight: 1.2,
          }}
        >
          This page got lost in transit.
        </h1>

        <p
          style={{
            fontSize: 14,
            color: "var(--color-muted)",
            lineHeight: 1.6,
            margin: "0 0 20px",
          }}
        >
          The address you&rsquo;re looking for doesn&rsquo;t exist. It may have been moved, deleted,
          or typed incorrectly.
        </p>

        {pathname && pathname !== "/" && (
          <p
            className="mono"
            style={{
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              padding: "10px 14px",
              fontSize: 12,
              color: "var(--color-ink-secondary)",
              margin: "0 0 24px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            No page at {pathname}
          </p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href="/"
            className="ds-btn ds-btn-primary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            <span>Back to dashboard</span>
          </Link>
          <Link
            href="/emails"
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Mail size={14} />
            <span>View emails</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
