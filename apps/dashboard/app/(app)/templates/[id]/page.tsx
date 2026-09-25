import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, templates, templateVersions } from "@calder/db";
import { getTenantContext } from "../../../../lib/auth";
import { EmptyState } from "../../../../components/empty-state";
import { TemplateEditor } from "../editor";

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
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>
        {tpl.name}{" "}
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--color-muted)", fontWeight: 400 }}
        >
          alias: {tpl.alias}
        </span>
      </h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
        {versions.length} {versions.length === 1 ? "version" : " versions"} · editing saves a new
        version; sends always take latest ({latest?.version ?? "none"}).
      </p>
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
        <div style={{ marginTop: 24, maxWidth: 760 }}>
          <p style={{ fontSize: 12, color: "var(--color-muted)", margin: "0 0 8px" }}>
            Version history
          </p>
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "6px 0",
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              <b className="mono">{v.version}</b>
              <span style={{ color: "var(--color-muted)" }}>
                {new Date(v.createdAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" · "}
                {v.html ? "html" : "text"}
                {v.subject ? " · subject" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
