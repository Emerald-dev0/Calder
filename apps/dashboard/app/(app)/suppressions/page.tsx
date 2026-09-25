import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { getDb, suppressions } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { SuppressionManager } from "./manager";
import { stringParam } from "../../../lib/pagination";

export const metadata = { title: "Calder — Suppressions" };

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: { project?: string; q?: string };
}) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Suppressions</h1>
        <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
          Bounced or complained addresses are blocked before send.
        </p>
        <EmptyState
          title="No project yet"
          description="Suppressions attach to a project. Create one first."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }

  const q = stringParam(searchParams.q);
  const db = getDb();
  const rows = await db
    .select()
    .from(suppressions)
    .where(
      and(
        inArray(suppressions.projectId, [scope.project.id]),
        q ? ilike(suppressions.email, `%${q}%`) : undefined
      )
    )
    .orderBy(desc(suppressions.createdAt))
    .limit(200);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Suppressions</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        {rows.length} blocked {rows.length === 1 ? "address" : "addresses"} on{" "}
        {scope.project.name}. Sends to these are refused before any provider call.
      </p>
      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/suppressions"
      />
      <form method="get" style={{ marginBottom: 12 }}>
        <input type="hidden" name="project" value={scope.project.id} />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search blocked addresses…"
          style={{
            width: "100%",
            maxWidth: 420,
            height: 38,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "0 12px",
            fontSize: 13,
          }}
        />
      </form>
      {rows.length === 0 && (
        <EmptyState
          title={q ? "Nothing matches" : "No suppressed addresses"}
          description={
            q
              ? "Try another search term."
              : "Calder hasn't recorded any bounced or complained addresses for this project. Block one manually below, or keep mailing well and stay here."
          }
        />
      )}
      <SuppressionManager
        projectId={scope.project.id}
        rows={rows.map((r) => ({
          id: r.id,
          email: r.email,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
