"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { PlatformRole } from "@calder/db";
import { setPlatformRole } from "./actions";

/**
 * M6.2: role grants/revokes require a typed reason (prompt) — the reason is
 * validated server-side and lands in the audit record with the change.
 */
export function RoleControls({
  userId,
  current,
  assignable,
}: {
  userId: string;
  current: PlatformRole | null;
  assignable: ReadonlyArray<{ readonly role: PlatformRole; readonly label: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(role: PlatformRole | null, label: string) {
    const suggested = role ? `Grant ${label}` : "Revoke role";
    const reason = window.prompt(
      `${suggested} — why?\n(Required; recorded in the audit log. Min 6 characters.)`,
      ""
    );
    if (reason === null) return;
    setBusy(true);
    setError(null);
    const outcome = await setPlatformRole(userId, role, reason);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error ?? "Action rejected.");
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {assignable.map((a) => (
        <button
          key={a.role}
          className="cp-btn"
          type="button"
          disabled={busy || current === a.role}
          onClick={() => void run(a.role, a.label)}
          style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }}
        >
          {current === a.role ? `is ${a.label}` : `→ ${a.label}`}
        </button>
      ))}
      {current ? (
        <button
          className="cp-btn danger"
          type="button"
          disabled={busy}
          onClick={() => void run(null, "revocation")}
          style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }}
        >
          Revoke
        </button>
      ) : null}
      {error && (
        <span role="alert" style={{ color: "#DC2626", fontSize: 12 }}>
          {error}
        </span>
      )}
    </div>
  );
}
