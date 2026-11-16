import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, templates, templateVersions } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import { EmptyState } from "../../../../components/empty-state";
import { TemplateEditor } from "../editor";
import { PublishVersionButton } from "../publish-version";
import { templateAiPrompt } from "../actions";
import { FileCode2, ArrowLeft, History } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
  CopyField,
} from "../../../../components/design-system";

export const metadata = { title: "Calder — Template" };

/** View, edit (new version), preview with sample vars, and test-send a template. */
export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    .where(and(eq(templates.id, id), inArray(templates.projectId, projectIds)))
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
    .select({
      id: templateVersions.id,
      version: templateVersions.version,
      status: templateVersions.status,
      subject: templateVersions.subject,
      html: templateVersions.html,
      text: templateVersions.text,
      variables: templateVersions.variables,
      publishedAt: templateVersions.publishedAt,
      createdAt: templateVersions.createdAt,
    })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(and(eq(templateVersions.templateId, tpl.id), inArray(templates.projectId, projectIds)))
    .orderBy(desc(templateVersions.createdAt), desc(templateVersions.id))
    .limit(12);
  const latest = versions[0];
  // What sends actually use: the newest published version, never a draft.
  const published = versions.find((v) => v.status === "published") ?? null;
  const hasDraft = versions.some((v) => v.status === "draft");
  const prompt = await templateAiPrompt(tpl.projectId, tpl.id);
  // Publishing changes what recipients receive, so it is a manager action —
  // the same rule the API's `manage` scope enforces.
  const canManage = ctx.memberships.some(
    (m) =>
      m.projects.some((p) => p.id === tpl.projectId) && (m.role === "owner" || m.role === "admin")
  );

  return (
    <div>
      <DsPageHeader
        icon={<FileCode2 size={18} />}
        title={tpl.name}
        badge={
          published ? (
            <StatusPill status="active" label={`live: ${published.version}`} />
          ) : (
            <StatusPill status="queued" label="not publishable yet" />
          )
        }
        description={
          published
            ? `${versions.length} ${versions.length === 1 ? "version" : "versions"} · sends use the published version (${published.version})${hasDraft ? "; newer drafts are waiting" : ""}.`
            : `No published version yet, so nothing can be sent from this template. Publish a version to make it sendable.`
        }
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
        <div className="ds-card" style={{ marginTop: 20 }} data-testid="ai-prompt">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Copy AI prompt</h2>
              <p className="ds-card-subtitle">
                A brief built from this template&apos;s own facts — its variables, subject, alias
                and sending domain. It tells an assistant which variables it may use, so a rewrite
                does not invent one that will never be supplied.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <pre
              className="mono"
              style={{
                margin: "0 0 12px",
                padding: 12,
                maxHeight: 320,
                overflow: "auto",
                fontSize: 11.5,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                background: "var(--color-surface-elevated)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
              }}
            >
              {prompt}
            </pre>
            <CopyField value={prompt} compact />
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div className="ds-card" style={{ marginTop: 20 }}>
          <div className="ds-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <History size={15} style={{ color: "var(--color-muted)" }} />
              <h2 className="ds-card-title">Version history</h2>
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
                  <StatusPill
                    status={v.status === "published" ? "active" : "queued"}
                    label={`${v.version} · ${v.status === "published" ? "published" : "draft"}`}
                  />
                  <span style={{ color: "var(--color-ink-secondary)" }}>
                    {v.subject || "(no subject)"}
                  </span>
                  {v.status === "draft" && (
                    <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                      sends still use {published?.version ?? "nothing"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    {v.html ? "HTML" : "Plaintext"}
                  </span>
                  {v.status === "draft" && (
                    <PublishVersionButton
                      projectId={tpl.projectId}
                      templateId={tpl.id}
                      version={v.version}
                      canManage={canManage}
                    />
                  )}
                  <RelativeTime value={v.publishedAt ?? v.createdAt} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
