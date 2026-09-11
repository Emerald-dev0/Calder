"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Plain-English 404: say what happened, show the missing address,
 * offer the way out. No developer jargon on a page anyone can land on.
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
        background: "var(--color-paper)",
        color: "var(--color-ink)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 480, width: "100%" }}>
        <p style={{ fontWeight: 700, fontSize: 20, margin: "0 0 24px", letterSpacing: "-0.01em" }}>
          Calder
        </p>

        <div
          style={{
            position: "relative",
            width: 180,
            height: 120,
            margin: "0 auto 24px",
            opacity: 0.9,
          }}
        >
          <Image
            src="/illustrations/empty-state-narrative.webp"
            alt=""
            fill
            sizes="180px"
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <span
          className="mono"
          style={{
            display: "inline-block",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#92400E",
            background: "#FEF3C7",
            padding: "4px 10px",
            borderRadius: 6,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          404 · Page not found
        </span>

        <h1
          style={{
            fontSize: "clamp(24px, 4vw, 30px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            margin: "0 0 12px",
            lineHeight: 1.15,
          }}
        >
          This page got lost in transit.
        </h1>

        <p
          style={{
            fontSize: 15,
            color: "var(--color-muted)",
            lineHeight: 1.6,
            margin: "0 0 24px",
          }}
        >
          The address you&rsquo;re looking for doesn&rsquo;t exist. It may have been moved, deleted,
          or typed incorrectly.
        </p>

        {pathname && pathname !== "/" && (
          <p
            className="mono"
            style={{
              background: "#ffffff",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "12px 16px",
              fontSize: 12,
              color: "#525252",
              margin: "0 0 28px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            No page at {pathname}
          </p>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link
            href="/"
            style={{
              display: "inline-block",
              background: "var(--color-ink)",
              color: "#ffffff",
              textDecoration: "none",
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Back to dashboard →
          </Link>
          <Link
            href="/emails"
            style={{
              display: "inline-block",
              background: "#ffffff",
              color: "var(--color-ink)",
              border: "1px solid var(--color-border)",
              textDecoration: "none",
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            View emails
          </Link>
        </div>
      </div>
    </div>
  );
}
