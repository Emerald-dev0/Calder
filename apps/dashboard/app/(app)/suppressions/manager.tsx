"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { addSuppression, removeSuppression } from "./actions";

const REASONS = ["manual", "bounce", "complaint"];

export function SuppressionManager({
  projectId,
  rows,
}: {
  projectId: string;
  rows: { id: string; email: string; reason: string; createdAt: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [reason, setReason] = React.useState("manual");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addSuppression(projectId, email, reason);
      setEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add suppression.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeSuppression(projectId, id);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="block@this-address.com"
            style={{
              flex: 1,
              minWidth: 220,
              height: 38,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "0 12px",
              fontSize: 13,
            }}
          />
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              height: 38,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              padding: "0 10px",
              fontSize: 13,
              background: "#fff",
            }}
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            onClick={() => void add()}
            disabled={busy || !email}
            style={{
              height: 38,
              padding: "0 16px",
              border: "none",
              borderRadius: 8,
              background: "#0B0C0E",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Block address
          </button>
        </div>
        {error && (
          <p role="alert" style={{ color: "#DC2626", fontSize: 13, margin: "8px 0 0" }}>
            {error}
          </p>
        )}
        <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "10px 0 0" }}>
          Bounces and complaints from provider feedback block automatically and show up here.
          Removing a row re-enables the recipient immediately.
        </p>
      </div>

      {rows.length > 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid #f5f5f5",
                fontSize: 13,
              }}
            >
              <span>
                <b className="mono" style={{ fontSize: 12.5 }}>
                  {r.email}
                </b>{" "}
                <span
                  style={{
                    fontSize: 11,
                    border: "1px solid var(--color-border)",
                    padding: "2px 8px",
                    borderRadius: 6,
                    color: "var(--color-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {r.reason}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                  {new Date(r.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <button
                  onClick={() => void remove(r.id)}
                  disabled={busy}
                  style={{
                    background: "none",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    padding: "3px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  unblock
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
