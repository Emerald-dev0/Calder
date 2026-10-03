"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut } from "lucide-react";
import { revokeSessionById, signOutOtherSessions } from "./actions";
import {
  StatusPill,
  RelativeTime,
  DsBanner,
  ConfirmDialog,
} from "../../../components/design-system";

type SessionRow = {
  id: string;
  current: boolean;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

function describeAgent(ua: string | null): string {
  if (!ua) return "Browser Session";
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
            : "Browser";
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
  const [confirmSignOutAll, setConfirmSignOutAll] = React.useState(false);

  return (
    <div className="ds-card" style={{ marginBottom: 20 }}>
      <div className="ds-card-header">
        <div>
          <h2 className="ds-card-title">Active Operator Sessions ({sessions.length})</h2>
          <p className="ds-card-subtitle">
            Devices currently authenticated to your account. Revoke any unrecognized session immediately.
          </p>
        </div>
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={() => setConfirmSignOutAll(true)}
            disabled={busy}
            className="ds-btn ds-btn-secondary ds-btn-sm"
          >
            <LogOut size={13} />
            <span>Sign out all other sessions</span>
          </button>
        )}
      </div>

      <div className="ds-card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {error && (
          <div style={{ marginBottom: 10 }}>
            <DsBanner tone="danger" title="Session error" description={error} />
          </div>
        )}
        {sessions.map((s, i) => (
          <div
            key={s.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 4px",
              borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
              fontSize: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-border)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-muted)",
                }}
              >
                <Laptop size={15} />
              </span>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b>{describeAgent(s.userAgent)}</b>
                  {s.current && <StatusPill status="active" label="This device" />}
                </div>
                <span className="mono" style={{ display: "block", fontSize: 11.5, color: "var(--color-muted)" }}>
                  {s.ip ?? "local session"} · signed in <RelativeTime value={s.createdAt} />
                </span>
              </div>
            </div>
            {!s.current && (
              <button
                type="button"
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
                className="ds-btn ds-btn-danger ds-btn-sm"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmSignOutAll}
        onClose={() => setConfirmSignOutAll(false)}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await signOutOtherSessions();
            if (r.revoked > 0) router.refresh();
          } finally {
            setBusy(false);
            setConfirmSignOutAll(false);
          }
        }}
        title="Sign out every other device?"
        description="Your current browser session will remain signed in, and all other active tokens will be revoked immediately."
        confirmLabel="Sign out other devices"
      />
    </div>
  );
}
