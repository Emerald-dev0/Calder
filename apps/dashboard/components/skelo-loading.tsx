"use client";

/*
 * Skelo-powered loading state for the dashboard's standard page layout.
 * The sample below mirrors DsPageHeader + metric cards + an activity table so
 * the measured skeleton approximates the page that replaces this loading UI.
 * Palette stays on the design system: prepare/. See globals.css (.calder-skelo).
 */

import * as React from "react";
import { Skeleton } from "skelo/next";

const METRIC_LABELS = ["Emails sent", "Delivery rate", "Bounce rate", "In queue"];

const ACTIVITY_ROWS = [
  "Delivered welcome@example.com",
  "Delivered verification@example.com",
  "Processing receipt@example.com",
  "Delivered reset@example.com",
  "Bounced test@example.com",
  "Delivered invite@example.com",
];

function SamplePage() {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: "var(--radius-lg, 10px)",
            border: "1px solid var(--color-border)",
          }}
        />
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Inbound Inbox</h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--color-muted)",
              maxWidth: 560,
            }}
          >
            Receive, parse, and route incoming emails into your application.
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {METRIC_LABELS.map((label, i) => (
          <div
            key={label}
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-lg, 12px)",
              padding: 16,
              background: "var(--color-surface)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--color-muted)" }}>{label}</div>
            <div style={{ margin: "6px 0", fontSize: 24, fontWeight: 600 }}>
              {["—", "—", "—", "—"][i]}
            </div>
            <div style={{ fontSize: 12, color: "var(--color-muted)" }}>Last 30 days</div>
          </div>
        ))}
      </div>

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg, 14px)",
          background: "var(--color-surface)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Recent activity
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {ACTIVITY_ROWS.map((row) => (
            <li
              key={row}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "10px 16px",
                borderBottom: "1px solid var(--color-border)",
                fontSize: 13,
              }}
            >
              <span>{row}</span>
              <span style={{ color: "var(--color-muted)" }}>2m ago</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="calder-skelo">
      <Skeleton template={<SamplePage />} animation="shimmer" minHeight={520} />
    </div>
  );
}
