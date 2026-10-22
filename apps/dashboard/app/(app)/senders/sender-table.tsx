"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Archive, CornerUpLeft, ShieldAlert } from "lucide-react";
import { StatusPill, ConfirmDialog } from "../../../components/design-system";
import { unarchiveSender } from "./actions";

export interface SenderTableRow {
  id: string;
  displayName: string;
  email: string;
  type: string;
  status: string;
  isDefault: boolean;
  isDefaultMarketing: boolean;
  replyTo: string | null;
  archivedAt: Date | string | null;
  lastUsedAt: Date | string | null;
}

export interface SenderHealthView {
  sent7d: number;
  bounced7d: number;
  bounceRate: number | null;
  warned: boolean;
}

function rateLabel(h: SenderHealthView | undefined): string {
  if (!h || h.bounceRate === null) return "—";
  return `${(h.bounceRate * 100).toFixed(1)}%`;
}

/**
 * The sender list.
 *
 * Health is a real seven-day measurement (bounce events ÷ sends), not a guess:
 * a sender with no traffic shows an em dash rather than a reassuring "healthy".
 * Defaults are shown as two separate markers because they are two separate
 * settings — one for transactional mail, one for broadcasts.
 */
export function SenderTable({
  projectId,
  senders,
  health,
  archivedCount,
  showArchived,
  basePath,
}: {
  projectId: string;
  senders: SenderTableRow[];
  health: Record<string, SenderHealthView>;
  archivedCount: number;
  showArchived: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [restoring, setRestoring] = useState<SenderTableRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const active = senders.filter((s) => !s.archivedAt);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
          {active.length} active sender{active.length === 1 ? "" : "s"}
          {archivedCount > 0 ? ` · ${archivedCount} archived` : ""}
        </span>
        {archivedCount > 0 && (
          <Link
            href={showArchived ? basePath : `${basePath}&archived=1`}
            className="ds-btn ds-btn-secondary ds-btn-sm"
            style={{ textDecoration: "none" }}
          >
            <Archive size={12} />
            <span>{showArchived ? "Hide archived" : "Show archived"}</span>
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--color-danger)", fontSize: 13, margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ color: "var(--color-success)", fontSize: 13, margin: "0 0 8px" }}>
          {notice}
        </p>
      )}

      {senders.length === 0 ? (
        <div className="ds-card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 4px" }}>
            No sender identities yet
          </p>
          <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
            Your application needs an authorized From address before Calder can deliver email.
            Verify a domain or connect Gmail below.
          </p>
        </div>
      ) : (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Sender</th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 150 }}>Defaults</th>
                  <th style={{ width: 170 }}>7-day health</th>
                  <th style={{ width: 120 }}>Last used</th>
                  <th style={{ width: 140, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((s) => {
                  const h = health[s.id];
                  const archived = Boolean(s.archivedAt);
                  return (
                    <tr key={s.id} style={archived ? { opacity: 0.65 } : undefined}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Link
                            href={`/senders/${s.id}?project=${projectId}`}
                            style={{
                              fontWeight: 600,
                              fontSize: 13.5,
                              color: "var(--color-ink)",
                              textDecoration: "none",
                            }}
                          >
                            {s.displayName}
                          </Link>
                          {archived && <StatusPill status="disabled" label="Archived" />}
                        </div>
                        <div className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                          {s.email}
                        </div>
                        {s.replyTo && (
                          <div style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                            Reply-To: <span className="mono">{s.replyTo}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <StatusPill status={archived ? "disabled" : s.status} />
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {s.isDefault ? (
                            <StatusPill status="active" label="Transactional" />
                          ) : (
                            <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>—</span>
                          )}
                          {s.isDefaultMarketing && <StatusPill status="active" label="Broadcast" />}
                          {!s.isDefault && !s.isDefaultMarketing && (
                            <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                              not a default
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {h && h.bounceRate !== null ? (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12.5,
                            }}
                            title={`${h.bounced7d} bounced of ${h.sent7d} sent in the last 7 days`}
                          >
                            <span
                              className="tabular-nums"
                              style={{
                                fontWeight: 600,
                                color: h.warned ? "var(--color-warning)" : "var(--color-ink)",
                              }}
                            >
                              {rateLabel(h)} bounce
                            </span>
                            {h.warned && <ShieldAlert size={13} color="var(--color-warning)" />}
                            <span style={{ color: "var(--color-muted)", fontSize: 11.5 }}>
                              {h.sent7d} sent
                            </span>
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                            No traffic in 7 days
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                        {s.lastUsedAt ? new Date(s.lastUsedAt).toISOString().slice(0, 10) : "Never"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {archived ? (
                          <button
                            type="button"
                            className="ds-btn ds-btn-secondary ds-btn-sm"
                            onClick={() => setRestoring(s)}
                          >
                            <CornerUpLeft size={12} />
                            <span>Restore</span>
                          </button>
                        ) : (
                          <Link
                            href={`/senders/${s.id}?project=${projectId}`}
                            className="ds-btn ds-btn-secondary ds-btn-sm"
                            style={{ textDecoration: "none" }}
                          >
                            <span>Manage</span>
                            <ArrowRight size={12} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        busy={busy}
        danger={false}
        title={`Restore ${restoring?.email ?? "sender"}?`}
        description={`${restoring?.email ?? "This sender"} will become selectable again and count towards your plan's sender-identity limit. It will not be a default until you set it as one.`}
        confirmLabel="Restore sender"
        onConfirm={async () => {
          if (!restoring) return;
          setBusy(true);
          setError(null);
          try {
            await unarchiveSender(restoring.id);
            setNotice(`${restoring.email} restored.`);
            setRestoring(null);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not restore the sender.");
          }
          setBusy(false);
        }}
      />
    </>
  );
}
