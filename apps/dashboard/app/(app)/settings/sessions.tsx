"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { revokeSessionById, signOutOtherSessions } from "./actions";

type SessionRow = {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua) && !/Chrome/.test(ua)
          ? "Safari"
          : /curl\//.test(ua)
            ? "curl"
            : "Other";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

/** M6.1 session inventory: every live session, revoke per-row, sign out everywhere else. */
export function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E5E5",
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <p style={{ fontWeight: 600, margin: 0 }}>Active sessions ({sessions.length})</p>
        {sessions.length > 1 && (
          <button
            onClick={async () => {
              if (!confirm("Sign out every other device? this one stays signed in.")) return;
              setBusy(true);
              setError(null);
              try {
                const r = await signOutOtherSessions();
                if (r.revoked > 0) router.refresh();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            style={{
              background: "none",
              border: "1px solid #E5E5E5",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Sign out all other sessions
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ color: "#DC2626", fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={{ marginTop: 10 }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "8px 0",
              borderTop: "1px solid #F0F0F0",
              fontSize: 13,
            }}
          >
            <div>
              <b>{describeAgent(s.userAgent)}</b>{" "}
              {s.current && (
                <span style={{ fontSize: 11, color: "#16A34A", fontWeight: 600 }}>
                  · this device
                </span>
              )}
              <span style={{ display: "block", fontSize: 12, color: "#737373" }}>
                {s.ip ?? "ip unknown"} · signed in{" "}
                {new Date(s.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
                {s.lastSeenAt
                  ? ` · last seen ${new Date(s.lastSeenAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : ""}
              </span>
            </div>
            {!s.current && (
              <button
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await revokeSessionById(s.id);
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not revoke.");
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                style={{
                  background: "none",
                  border: "1px solid #E5E5E5",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
