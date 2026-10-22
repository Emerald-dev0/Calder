import Link from "next/link";
import { notFound } from "next/navigation";
import { Megaphone, ArrowLeft, Send, TestTube2, XCircle } from "lucide-react";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { DsBanner, DsPageHeader, StatCard, StatusPill } from "../../../../components/design-system";
import {
  broadcastDetail,
  cancelBroadcastAction,
  saveBroadcastAction,
  sendBroadcastAction,
  testBroadcastAction,
} from "../actions";

export const metadata = { title: "Calder — Broadcast" };

const EDITABLE = new Set(["draft", "scheduled", "paused"]);

export default async function BroadcastDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) notFound();

  const detail = await broadcastDetail(scope.project.id, id);
  if (!detail) notFound();
  const { broadcast, counts } = detail;
  const projectId = scope.project.id;
  const editable = EDITABLE.has(broadcast.status);
  const sentish = ["sending", "sent", "paused"].includes(broadcast.status);

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Link href={`/broadcasts?project=${projectId}`} className="ds-btn" style={{ fontSize: 12, textDecoration: "none" }}>
          <ArrowLeft size={12} />
          <span>All broadcasts</span>
        </Link>
      </div>

      <DsPageHeader
        icon={<Megaphone size={18} />}
        title={broadcast.name}
        description={broadcast.subject}
        badge={<StatusPill status={broadcast.status} />}
      />

      {broadcast.status === "paused" && broadcast.pausedReason && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner tone="warning" title="Paused" description={broadcast.pausedReason} />
        </div>
      )}

      {counts.total > 0 && (
        <div className="ds-stat-grid" style={{ marginBottom: 20 }}>
          <StatCard label="Recipients" value={counts.total} sub="frozen when sending started" />
          <StatCard label="Queued" value={counts.queued} sub="accepted, not yet delivered" />
          <StatCard label="Delivered" value={counts.delivered + counts.sent} sub="provider accepted" />
          <StatCard
            label="Skipped"
            value={counts.skipped}
            sub={counts.skippedByReason.map((row) => `${row.total} ${row.reason}`).join(" · ") || "none"}
          />
          <StatCard label="Failed" value={counts.failed + counts.bounced} sub="bounced or rejected" />
        </div>
      )}

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)", marginBottom: 20 }}>
        <form action={saveBroadcastAction} className="ds-card">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="broadcastId" value={broadcast.id} />
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Content</h2>
              <p className="ds-card-subtitle">
                {editable
                  ? "Editable until the first recipient is queued."
                  : "Frozen: this broadcast has already been sent, and the record must match what left the building."}
              </p>
            </div>
          </div>
          <div className="ds-card-body" style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>Internal name</span>
              <input name="name" defaultValue={broadcast.name} disabled={!editable} className="ds-input" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>Subject</span>
              <input name="subject" defaultValue={broadcast.subject} disabled={!editable} className="ds-input" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>Preview text</span>
              <input name="previewText" defaultValue={broadcast.previewText ?? ""} disabled={!editable} className="ds-input" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
              <span>HTML body</span>
              <textarea
                name="html"
                defaultValue={broadcast.html ?? ""}
                rows={16}
                disabled={!editable}
                className="ds-input"
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
              />
            </label>
            {editable && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="ds-btn">
                  Save changes
                </button>
              </div>
            )}
          </div>
        </form>

        <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <div className="ds-card">
            <div className="ds-card-header">
              <h2 className="ds-card-title">Send</h2>
            </div>
            <div className="ds-card-body" style={{ display: "grid", gap: 10 }}>
              <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: 0 }}>
                Recipients are frozen at this moment. Everyone already unsubscribed, bounced or
                suppressed is skipped and counted, never silently dropped.
              </p>
              <form action={testBroadcastAction} style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="broadcastId" value={broadcast.id} />
                <input
                  name="to"
                  type="email"
                  required
                  defaultValue={ctx.user.email}
                  className="ds-input"
                  aria-label="Test recipient"
                />
                <button type="submit" className="ds-btn">
                  <TestTube2 size={14} />
                  <span>Send a test to myself</span>
                </button>
              </form>

              {!sentish && broadcast.status !== "cancelled" && (
                <form
                  action={sendBroadcastAction}
                  style={{ display: "grid", gap: 8, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}
                >
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="broadcastId" value={broadcast.id} />
                  <button type="submit" className="ds-btn ds-btn-primary">
                    <Send size={14} />
                    <span>
                      {broadcast.status === "paused" ? "Resume sending" : "Send to the audience"}
                    </span>
                  </button>
                </form>
              )}

              {["draft", "scheduled", "paused", "sending"].includes(broadcast.status) && (
                <form action={cancelBroadcastAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="broadcastId" value={broadcast.id} />
                  <button type="submit" className="ds-btn" style={{ width: "100%" }}>
                    <XCircle size={14} />
                    <span>Cancel broadcast</span>
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="ds-card">
            <div className="ds-card-header">
              <h2 className="ds-card-title">Details</h2>
            </div>
            <div className="ds-card-body" style={{ display: "grid", gap: 8, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Status</span>
                <StatusPill status={broadcast.status} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Click tracking</span>
                <span>{broadcast.trackingClicks ? "On" : "Off"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Started</span>
                <span>{broadcast.startedAt ? broadcast.startedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Completed</span>
                <span>{broadcast.completedAt ? broadcast.completedAt.toISOString().slice(0, 16).replace("T", " ") : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
