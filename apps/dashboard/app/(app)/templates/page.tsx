import { desc, inArray } from "drizzle-orm";
import { getDb, templates } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import Link from "next/link";

export const metadata = { title: "Calder — Templates" };

export default async function TemplatesPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Templates</h1>
        <EmptyState
          title="No project yet"
          description="Create a project and templates will appear here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(templates)
    .where(inArray(templates.projectId, projectIds))
    .orderBy(desc(templates.createdAt))
    .limit(20);
  if (rows.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Templates</h1>
        <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
          Reusable email templates for your application.
        </p>
        <EmptyState
          title="No templates yet"
          description="Create reusable email templates for welcome emails, OTPs, receipts, and notifications. Variables, preview, and test send included."
          actionLabel="Create template"
          actionHref="/templates/new"
        />
      </div>
    );
  }
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Templates</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        {rows.length} {rows.length === 1 ? "template" : "templates"} ·{" "}
        <Link href="/templates/new" style={{ textDecoration: "underline" }}>
          New template
        </Link>
      </p>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {rows.map((t) => (
          <Link
            key={t.id}
            href={`/templates/${t.id}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderBottom: "1px solid #f5f5f5",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span>
              <b style={{ fontSize: 13 }}>{t.name}</b>{" "}
              <span style={{ color: "var(--color-muted)", fontSize: 12 }}>
                · {t.alias ?? "no alias"}
              </span>
            </span>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
              {new Date(t.createdAt).toLocaleDateString()}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
