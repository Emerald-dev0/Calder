"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AtSign } from "lucide-react";
import { setRawSenderPolicy } from "./actions";

/**
 * The raw-address setting.
 *
 * Live sends must resolve to a sender identity. The one exception a project can
 * grant itself is a bare address at a domain it has verified — the customer
 * proved they own the domain, and the provider permits exactly that. It is off
 * unless someone turns it on: "you can send as anyone at my domain" is a
 * decision a workspace should make on purpose.
 *
 * Rendered even when a project would never use it, because the alternative is a
 * customer discovering it from a `422` and having to guess where it lives.
 */
export function RawSenderPolicyCard({
  projectId,
  enabled,
  verifiedDomains,
  canManage,
}: {
  projectId: string;
  enabled: boolean;
  verifiedDomains: string[];
  canManage: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const result = await setRawSenderPolicy(projectId, next);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOn(result.policy.enabled);
    router.refresh();
  }

  return (
    <div className="ds-card" data-testid="raw-sender-policy">
      <div className="ds-card-body">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AtSign size={16} aria-hidden="true" style={{ marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>
              Send from addresses without a sender identity
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-muted)" }}>
              {enabled
                ? "On. Live sends may use a bare address, but only at a domain this project has verified — anything else is refused."
                : "Off. Live sends must use a verified sender identity; anything else is refused with an error pointing here."}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--color-muted)" }}>
              {verifiedDomains.length > 0 ? (
                <>Verified domains: {verifiedDomains.join(", ")}.</>
              ) : (
                <>
                  No verified domain yet —{" "}
                  <Link href={`/domains?project=${projectId}`}>verify one first</Link>.
                </>
              )}
            </p>
            {error && (
              <p role="alert" style={{ margin: "8px 0 0", fontSize: 13 }}>
                {error}
              </p>
            )}
          </div>
          {canManage && (
            <button
              type="button"
              className={on ? "ds-btn ds-btn-secondary" : "ds-btn ds-btn-primary"}
              disabled={busy || (!on && verifiedDomains.length === 0)}
              onClick={() => void toggle(!on)}
              data-testid="raw-sender-toggle"
            >
              {busy ? "Saving…" : on ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
