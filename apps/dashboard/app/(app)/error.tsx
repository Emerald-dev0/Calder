"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { StatusPill } from "../../components/design-system";

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="ds-card"
      style={{
        maxWidth: 520,
        margin: "48px auto",
        padding: "36px 28px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: "var(--color-danger-bg)",
          color: "var(--color-danger)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <AlertTriangle size={22} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <StatusPill status="failed" label="Runtime Exception" />
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
        Something went wrong rendering this view
      </h1>
      <p
        style={{
          fontSize: 13.5,
          color: "var(--color-muted)",
          lineHeight: 1.55,
          margin: "0 0 18px",
        }}
      >
        {error.message || "An unexpected error occurred while loading dashboard telemetry."}
      </p>
      {error.digest && (
        <p
          className="mono"
          style={{
            fontSize: 11.5,
            color: "var(--color-muted)",
            marginBottom: 18,
          }}
        >
          Digest: {error.digest}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button type="button" onClick={reset} className="ds-btn ds-btn-primary">
          <RefreshCw size={14} />
          <span>Retry view</span>
        </button>
        <Link href="/" className="ds-btn ds-btn-secondary" style={{ textDecoration: "none" }}>
          <Home size={14} />
          <span>Overview</span>
        </Link>
      </div>
    </div>
  );
}
