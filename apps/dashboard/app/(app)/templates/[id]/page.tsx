import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, templates, templateVersions } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import { EmptyState } from "../../../../components/empty-state";
import { TemplateEditor } from "../editor";
import { FileCode2, ArrowLeft, History } from "lucide-react";
import { DsPageHeader, StatusPill, RelativeTime } from "../../../../components/design-system";

export const metadata = { title: "Calder — Template" };

/** View, edit (new version), preview with sample vars, and test-send a template. */
export default async function TemplateDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <EmptyState
        title="No project yet"
        description="Create a project before managing templates."
        actionLabel="Create project"
        actionHref="/onboarding"
      />
    );
  }
  const db = getDb();
  const [tpl] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, params.id), inArray(templates.projectId, projectIds)))
    .limit(1);
  if (!tpl) {
    return (
      <EmptyState
        title="Template not found"
        description="It may have been deleted, or belongs to a project you can't see."
        actionLabel="Back to templates"
        actionHref="/templates"
      />
    );
  }
  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, tpl.id))
    .orderBy(desc(templateVersions.createdAt))
    .limit(12);
  const latest = versions[0];

  return (
    <div>
      <DsPageHeader
        icon={<FileCode2 size={18} />}
        title={tpl.name}
        badge={
          <StatusPill
            status="active"
            label={`alias: ${tpl.alias ?? "none"} · ${latest?.version ?? "v1"}`}
          />
        }
        description={`${versions.length} ${versions.length === 1 ? "version" : "versions"} · saving publishes a new immutable version; API sends resolve latest (${latest?.version ?? "none"}).`}
        actions={
          <Link
            href="/templates"
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            <span>All templates</span>
          </Link>
        }
      />

      <TemplateEditor
        projectId={tpl.projectId}
        mode="edit"
        templateId={tpl.id}
        initial={{
          subject: latest?.subject ?? "",
          html: latest?.html ?? "",
          text: latest?.text ?? "",
        }}
      />

      {versions.length > 0 && (
        <div className="ds-card" style={{ marginTop: 20 }}>
          <div className="ds-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <History size={15} style={{ color: "var(--color-muted)" }} />
              <h2 className="ds-card-title">Immutable Version History</h2>
            </div>
          </div>
          <div className="ds-card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
            {versions.map((v, i) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12.5,
                  padding: "9px 4px",
                  borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusPill status={i === 0 ? "active" : "queued"} label={`v${v.version}`} />
                  <span style={{ color: "var(--color-ink-secondary)" }}>
                    {v.subject || "(no subject)"}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    {v.html ? "HTML" : "Plaintext"}
                  </span>
                  <RelativeTime value={v.createdAt} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
