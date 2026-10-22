import Link from "next/link";
import { Megaphone, Plus, ArrowRight } from "lucide-react";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { DsPageHeader, StatCard, StatusPill } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";
import { broadcastList } from "./actions";

export const metadata = { title: "Calder — Broadcasts" };

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);

  if (!scope) {
    return (
      <div>
        <DsPageHeader icon={<Megaphone size={18} />} title="Broadcasts" description="Create a project first." />
        <EmptyState
          title="No project found"
          description="Broadcasts belong to a project. Create one in workspace settings."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const { projectId, rows } = await broadcastList(scope.project.id);
  const sent = rows.filter((row) => row.status === "sent").length;

  return (
    <div>
      <DsPageHeader
        icon={<Megaphone size={18} />}
        title="Broadcasts"
        description="One message, one audience. Marketing mail goes out under its own sender and never shares a lane with receipts or password resets."
        actions={
          <Link href={`/broadcasts/new?project=${projectId}`} className="ds-btn ds-btn-primary" style={{ textDecoration: "none" }}>
            <Plus size={14} />
            <span>New broadcast</span>
          </Link>
        }
      />

      <div className="ds-stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Broadcasts" value={rows.length} sub="drafts and sends in this project" />
        <StatCard label="Sent" value={sent} sub="completed" />
        <StatCard
          label="Recipients"
          value={rows.reduce((sum, row) => sum + (row.recipientCount ?? 0), 0)}
          sub="across every broadcast"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No broadcasts yet"
          description="A broadcast sends one message to one audience, with unsubscribe handled for you."
          actionLabel="New broadcast"
          actionHref={`/broadcasts/new?project=${projectId}`}
          illustration="narrative"
        />
      ) : (
        <div className="ds-card">
          <div className="ds-card-body" style={{ display: "grid", gap: 0 }}>
            {rows.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 16,
                  alignItems: "center",
                  padding: "14px 0",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/broadcasts/${row.id}?project=${projectId}`}
                    style={{ fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                  >
                    {row.name}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {row.subject} · to {row.audiences ?? "an archived audience"} ·{" "}
                    {formatDate(row.completedAt ?? row.startedAt ?? row.createdAt)}
                  </div>
                </div>
                <StatusPill status={row.status} />
                <Link
                  href={`/broadcasts/${row.id}?project=${projectId}`}
                  className="ds-btn"
                  style={{ fontSize: 12, textDecoration: "none" }}
                >
                  <span>Open</span>
                  <ArrowRight size={12} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
