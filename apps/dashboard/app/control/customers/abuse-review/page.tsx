import Link from "next/link";
import { getDb, abuseReviewHistory, canEnforceAbuseReview, listAbuseReviewQueue } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/app/control/_components/ui";
import { applyAbuseReviewAction } from "./actions";

export const dynamic = "force-dynamic";

const REASON_COPY: Record<string, { tone: "warn" | "bad" | "info"; label: string; note: string }> =
  {
    auto_paused: {
      tone: "warn",
      label: "paused automatically",
      note: "A bounce or complaint rate crossed the policy threshold. The customer was mailed.",
    },
    suspended: {
      tone: "bad",
      label: "suspended by an operator",
      note: "Sending is off and the project keys were revoked.",
    },
    watching: {
      tone: "info",
      label: "watching",
      note: "Still sending, but complaints arrived inside the window.",
    },
  };

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function ago(date: Date | null): string {
  if (!date) return "never";
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const NOTICE: Record<string, { tone: "ok" | "warn" | "bad" | "info"; text: string }> = {
  applied: { tone: "ok", text: "Decision recorded and applied. It is in the audit log." },
  noted: { tone: "ok", text: "Note added to the workspace's review history." },
  forbidden: { tone: "bad", text: "Your role can read this queue but not enforce on it." },
  note_required: {
    tone: "bad",
    text: "A decision needs a note of at least 6 characters — the next operator reads it.",
  },
  not_found: { tone: "bad", text: "That workspace no longer exists." },
  unsupported_action: { tone: "bad", text: "Unsupported action." },
  error: { tone: "bad", text: "Nothing changed. Try again." },
};

/**
 * The abuse review queue (F-5.4).
 *
 * Three groups in one list, worst first: workspaces the policy paused, ones an
 * operator suspended, and ones still sending that produced complaints this week
 * ("watching"). Every decision carries a note and the operator's id into the
 * audit log, and every decision can be undone by the next one — which is what
 * makes "attributable and reversible" true rather than aspirational.
 */
export default async function AbuseReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string; org?: string }>;
}) {
  const ctx = await requireSection("customers");
  const query = await searchParams;
  const db = getDb();
  const canEnforce = canEnforceAbuseReview(ctx.role);

  const queue = await listAbuseReviewQueue(db, { limit: 50 });
  const focused = query.org ? queue.find((entry) => entry.organizationId === query.org) : undefined;
  const history = focused ? await abuseReviewHistory(db, focused.organizationId, 12) : [];

  const notice = query.review ? NOTICE[query.review] : undefined;
  const paused = queue.filter((entry) => entry.reason === "auto_paused").length;
  const suspended = queue.filter((entry) => entry.reason === "suspended").length;
  const watching = queue.filter((entry) => entry.reason === "watching").length;

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Abuse review"
        subtitle="Workspaces that need a human. Every decision is attributed, noted, and reversible."
        right={
          <Badge tone={canEnforce ? "ok" : "warn"}>
            {canEnforce ? `${ctx.role} — can enforce` : `${ctx.role} — read only`}
          </Badge>
        }
      />

      {notice ? (
        <div className="cp-panel" style={{ marginBottom: 16 }}>
          <div className="cp-panel-body">
            <p style={{ margin: 0, fontSize: 13.5 }}>{notice.text}</p>
          </div>
        </div>
      ) : null}

      <div className="cp-stats">
        <Stat label="Paused by policy" value={paused} hint="bounce or complaint threshold" />
        <Stat label="Suspended" value={suspended} hint="operator decision" />
        <Stat label="Watching" value={watching} hint="sending, complaints in 7 days" />
      </div>

      {queue.length === 0 ? (
        <Panel title="Queue" caption="Nothing needs review right now." flush>
          <Empty title="Queue is empty">
            No workspace is paused, suspended, or producing complaints this week.
          </Empty>
        </Panel>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {queue.map((entry) => {
            const copy = REASON_COPY[entry.reason]!;
            return (
              <Panel
                key={entry.organizationId}
                title={`${entry.name} · ${entry.slug}`}
                caption={`${copy.label} · last decision ${ago(entry.lastReview?.at ?? null)}`}
                flush
              >
                <div className="cp-panel-body" style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      alignItems: "center",
                      fontSize: 13,
                    }}
                  >
                    <Badge tone={copy.tone}>{entry.status.replace(/_/g, " ")}</Badge>
                    <span style={{ color: "var(--cp-muted)" }}>{copy.note}</span>
                    <Link
                      className="cp-btn"
                      style={{ fontSize: 12, padding: "3px 10px" }}
                      href={`/control/customers/organizations/${entry.organizationId}`}
                    >
                      Open workspace
                    </Link>
                  </div>

                  {entry.statusReason ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: "var(--cp-muted)" }}>
                      Recorded reason: <span className="mono">{entry.statusReason}</span>
                    </p>
                  ) : null}

                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12.5 }}>
                    <span>
                      <b>{entry.metrics.sent}</b> accepted · 7 days
                    </span>
                    <span>
                      bounces <b>{entry.metrics.bounced}</b> ({pct(entry.metrics.bounceRate)})
                    </span>
                    <span>
                      complaints <b>{entry.metrics.complained}</b> (
                      {pct(entry.metrics.complaintRate)})
                    </span>
                    {entry.lastReview ? (
                      <span style={{ color: "var(--cp-muted)" }}>
                        last: {entry.lastReview.action.replace("organization.", "")} by{" "}
                        <span className="mono">{entry.lastReview.actorUserId ?? "system"}</span>
                      </span>
                    ) : null}
                  </div>

                  {canEnforce ? (
                    <form action={applyAbuseReviewAction} className="cp-action-form">
                      <input type="hidden" name="organizationId" value={entry.organizationId} />
                      <select
                        className="cp-select"
                        name="decision"
                        defaultValue={entry.status === "active" ? "pause" : "reinstate"}
                        aria-label={`Decision for ${entry.name}`}
                      >
                        <option value="reinstate">Reinstate sending</option>
                        <option value="pause">Pause (keep keys, stop sends)</option>
                        <option value="suspend">Suspend (revoke keys)</option>
                        <option value="note">Add a note only</option>
                      </select>
                      <input
                        className="cp-input"
                        type="text"
                        name="note"
                        required
                        minLength={6}
                        maxLength={500}
                        placeholder="what you checked and why (required, audited)"
                        style={{ minWidth: 280 }}
                        aria-label="Review note"
                      />
                      <button className="cp-btn primary" type="submit">
                        Record decision
                      </button>
                    </form>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12.5, color: "var(--cp-muted)" }}>
                      Ask a founder, platform admin or security operator to act on this.
                    </p>
                  )}

                  {focused?.organizationId === entry.organizationId ? (
                    <div>
                      <h3 style={{ fontSize: 12.5, margin: "4px 0 6px" }}>Review history</h3>
                      {history.length === 0 ? (
                        <p style={{ margin: 0, fontSize: 12.5, color: "var(--cp-muted)" }}>
                          No review rows yet.
                        </p>
                      ) : (
                        <table className="cp-table">
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>Action</th>
                              <th>From → to</th>
                              <th>Note</th>
                              <th>Operator</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((row) => (
                              <tr key={row.id}>
                                <td>{ago(row.at)}</td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {row.action}
                                </td>
                                <td style={{ fontSize: 12 }}>
                                  {row.from ?? "—"} → {row.to ?? "—"}
                                </td>
                                <td style={{ fontSize: 12 }}>{row.note ?? "—"}</td>
                                <td className="mono" style={{ fontSize: 12 }}>
                                  {row.actorUserId ?? "system"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : (
                    <Link
                      style={{ fontSize: 12.5 }}
                      href={`/control/customers/abuse-review?org=${encodeURIComponent(entry.organizationId)}`}
                    >
                      Show review history
                    </Link>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
