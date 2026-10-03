import { and, desc, ilike, inArray } from "drizzle-orm";
import { getDb, suppressions } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { SuppressionManager } from "./manager";
import { stringParam } from "../../../lib/pagination";
import { ShieldBan, Search } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

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
        <DsPageHeader
          icon={<ShieldBan size={18} />}
          title="Suppressions"
          description="Bounced or complained addresses are blocked before send."
        />
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
        q ? ilike(suppressions.email, `%${q}%`) : undefined,
      ),
    )
    .orderBy(desc(suppressions.createdAt))
    .limit(200);

  return (
    <div>
      <DsPageHeader
        icon={<ShieldBan size={18} />}
        title="Suppressions & Reputation Guard"
        badge={
          <StatusPill
            status="healthy"
            label={`${rows.length} blocked ${rows.length === 1 ? "address" : "addresses"}`}
          />
        }
        description={`Protecting ${scope.project.name} sender reputation — sends to suppressed recipients are refused before any provider call.`}
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/suppressions"
      />

      <form method="get" style={{ marginBottom: 16 }}>
        <input type="hidden" name="project" value={scope.project.id} />
        <div style={{ position: "relative", maxWidth: 420 }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 11,
              top: 11,
              color: "var(--color-muted)",
            }}
          />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search blocked addresses…"
            className="ds-input"
            style={{ paddingLeft: 32 }}
          />
        </div>
      </form>

      {rows.length === 0 && (
        <EmptyState
          icon={<ShieldBan size={22} />}
          title={q ? "Nothing matches" : "No suppressed addresses"}
          description={
            q
              ? "Try another search term."
              : "Calder hasn't recorded any bounced or complained addresses for this project. Block one manually below, or keep mailing cleanly."
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
