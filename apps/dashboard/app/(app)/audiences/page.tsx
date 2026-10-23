import Link from "next/link";
import { Users, Plus, Archive, ArrowRight } from "lucide-react";
import { getDb } from "@calder/db";
import { listAudiences } from "@calder/audiences";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { DsPageHeader, StatCard } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";
import { archiveAudienceAction, createAudienceAction } from "./actions";

export const metadata = { title: "Calder — Audiences" };

export default async function AudiencesPage({
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
        <DsPageHeader
          icon={<Users size={18} />}
          title="Audiences"
          description="Lists of people you may email. Create a project first."
        />
        <EmptyState
          title="No project found"
          description="Audiences belong to a project. Create one in workspace settings."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const projectId = scope.project.id;
  const audiences = await listAudiences(getDb(), projectId);
  const totalSubscribed = audiences.reduce((sum, audience) => sum + audience.subscribed, 0);

  return (
    <div>
      <DsPageHeader
        icon={<Users size={18} />}
        title="Audiences"
        description="Who you may email, and the consent that says so. Broadcasts always send to one of these lists."
      />

      <div className="ds-stat-grid" style={{ marginBottom: 20 }}>
        <StatCard label="Audiences" value={audiences.length} sub="live lists in this project" />
        <StatCard label="Subscribed people" value={totalSubscribed} sub="across every list" />
        <StatCard
          label="Unsubscribed"
          value={audiences.reduce((sum, audience) => sum + audience.unsubscribed, 0)}
          sub="kept, never deleted"
        />
      </div>

      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Create an audience</h2>
            <p className="ds-card-subtitle">
              A list is a set of contacts with one consent story. Name it after how people got here
              (&ldquo;Newsletter · site footer&rdquo;), not after what you plan to send.
            </p>
          </div>
        </div>
        <div className="ds-card-body">
          <form
            action={createAudienceAction}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input
              name="name"
              required
              maxLength={255}
              placeholder="Audience name"
              aria-label="Audience name"
              className="ds-input"
              style={{ minWidth: 220, flex: 1 }}
            />
            <input
              name="description"
              maxLength={500}
              placeholder="Where these contacts came from (optional)"
              aria-label="Description"
              className="ds-input"
              style={{ minWidth: 260, flex: 2 }}
            />
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" name="doubleOptIn" />
              Double opt-in
            </label>
            <button type="submit" className="ds-btn ds-btn-primary">
              <Plus size={14} />
              <span>Create</span>
            </button>
          </form>
        </div>
      </div>

      {audiences.length === 0 ? (
        <EmptyState
          title="No audiences yet"
          description="Create a list above, then add contacts one by one or paste a CSV."
          illustration="narrative"
        />
      ) : (
        <div className="ds-card">
          <div className="ds-card-body" style={{ display: "grid", gap: 0 }}>
            {audiences.map((audience) => (
              <div
                key={audience.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto",
                  gap: 16,
                  alignItems: "center",
                  padding: "14px 0",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/audiences/${audience.id}?project=${projectId}`}
                    style={{ fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                  >
                    {audience.name}
                  </Link>
                  <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                    {audience.subscribed.toLocaleString("en-US")} subscribed
                    {audience.unsubscribed > 0
                      ? ` · ${audience.unsubscribed.toLocaleString("en-US")} unsubscribed`
                      : ""}
                    {audience.pendingConfirmation > 0
                      ? ` · ${audience.pendingConfirmation} pending confirmation`
                      : ""}
                    {audience.description ? ` · ${audience.description}` : ""}
                  </div>
                </div>
                <form action={archiveAudienceAction}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="audienceId" value={audience.id} />
                  <button
                    type="submit"
                    className="ds-btn"
                    style={{ fontSize: 12 }}
                    title="Archive this list. History stays; it can no longer be mailed."
                  >
                    <Archive size={12} />
                    <span>Archive</span>
                  </button>
                </form>
                <Link
                  href={`/audiences/${audience.id}?project=${projectId}`}
                  className="ds-btn ds-btn-secondary"
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
