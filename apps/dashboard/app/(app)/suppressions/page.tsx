import { and, count, desc, eq, ilike } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, suppressions, SUPPRESSION_REASONS } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { SuppressionAddPanel, SuppressionRowAction } from "./manager";
import {
  cursorWhere,
  decodeCursor,
  encodeCursor,
  stringParam,
  PAGE_SIZE,
} from "../../../lib/pagination";
import { ShieldBan, Search, Download } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
  CopyableMono,
  DsBanner,
} from "../../../components/design-system";
import { buildTabs, reasonMeta, reasonPillStatus } from "../../../lib/suppressions/reasons";

export const metadata = { title: "Calder — Suppressions" };

const FILTERABLE = new Set<string>([...SUPPRESSION_REASONS, "all"]);

export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    q?: string;
    reason?: string;
    cursor?: string;
    imported?: string;
  }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, query.project);
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

  const projectId = scope.project.id;
  const q = stringParam(query.q);
  const reasonParam = stringParam(query.reason);
  const reason = reasonParam && FILTERABLE.has(reasonParam) ? reasonParam : "all";

  let cursor: ReturnType<typeof decodeCursor>;
  try {
    cursor = decodeCursor(query.cursor);
  } catch {
    notFound();
  }

  const db = getDb();

  // Counts drive the filter tabs. One grouped query, not one per tab.
  const countRows = await db
    .select({ reason: suppressions.reason, count: count() })
    .from(suppressions)
    .where(eq(suppressions.projectId, projectId))
    .groupBy(suppressions.reason);
  const tabs = buildTabs(countRows.map((r) => ({ reason: r.reason, count: Number(r.count) })));
  const total = tabs[0]?.count ?? 0;

  const where = and(
    eq(suppressions.projectId, projectId),
    reason === "all" ? undefined : eq(suppressions.reason, reason),
    q ? ilike(suppressions.email, `%${q}%`) : undefined,
    cursorWhere(cursor, suppressions.createdAt, suppressions.id)
  );

  const rows = await db
    .select({
      id: suppressions.id,
      email: suppressions.email,
      reason: suppressions.reason,
      createdAt: suppressions.createdAt,
      organizationId: suppressions.organizationId,
    })
    .from(suppressions)
    .where(where)
    .orderBy(desc(suppressions.createdAt), desc(suppressions.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]!) : null;

  const filterQuery = new URLSearchParams({ project: projectId });
  if (q) filterQuery.set("q", q);
  if (reason !== "all") filterQuery.set("reason", reason);

  const importedCount = stringParam(query.imported);

  return (
    <div>
      <DsPageHeader
        icon={<ShieldBan size={18} />}
        title="Suppressions"
        badge={
          <StatusPill
            status="suppressed"
            label={`${total.toLocaleString("en-US")} blocked ${total === 1 ? "address" : "addresses"}`}
          />
        }
        description="Bounced or complained addresses are blocked before any provider call. Bounces and complaints follow the address across every project in this workspace; unsubscribes apply to broadcast mail only."
        actions={
          <a
            href={`/suppressions/export?${filterQuery.toString()}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Download size={14} />
            <span>Export CSV</span>
          </a>
        }
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={projectId}
        basePath="/suppressions"
      />

      {importedCount && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="success"
            title="Import complete"
            description={`${Number(importedCount).toLocaleString("en-US")} address${Number(importedCount) === 1 ? "" : "es"} added to the suppression list.`}
          />
        </div>
      )}

      {/* Reason tabs double as the reason filter; both live in the URL. */}
      <div
        className="ds-tabs"
        role="tablist"
        aria-label="Filter by reason"
        style={{ marginBottom: 16 }}
      >
        {tabs.map((tab) => {
          const params = new URLSearchParams();
          params.set("project", projectId);
          if (q) params.set("q", q);
          if (tab.value !== "all") params.set("reason", tab.value);
          const active = tab.value === reason;
          return (
            <Link
              key={tab.value}
              href={`/suppressions?${params.toString()}`}
              role="tab"
              aria-selected={active}
              className={`ds-tab ${active ? "is-active" : ""}`}
              style={{ textDecoration: "none" }}
            >
              <span>{tab.label}</span>
              <span className="tabular-nums" style={{ opacity: 0.7, fontSize: 11.5 }}>
                {tab.count}
              </span>
            </Link>
          );
        })}
      </div>

      <form method="get" style={{ marginBottom: 16, display: "flex", gap: 10 }}>
        <input type="hidden" name="project" value={projectId} />
        {reason !== "all" && <input type="hidden" name="reason" value={reason} />}
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 11, top: 11, color: "var(--color-muted)" }}
          />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search blocked addresses…"
            className="ds-input mono"
            style={{ paddingLeft: 32 }}
            aria-label="Search suppressed addresses"
          />
        </div>
        <button type="submit" className="ds-btn ds-btn-secondary">
          Search
        </button>
        {(q || reason !== "all") && (
          <Link
            href={`/suppressions?project=${projectId}`}
            className="ds-btn ds-btn-ghost"
            style={{ textDecoration: "none" }}
          >
            Clear
          </Link>
        )}
      </form>

      {page.length === 0 ? (
        <EmptyState
          icon={<ShieldBan size={22} />}
          title={
            q || reason !== "all" ? "Nothing matches these filters" : "No suppressed addresses"
          }
          description={
            q || reason !== "all"
              ? "Try a different search term, or switch back to the All tab."
              : "Calder hasn't recorded any bounced or complained addresses for this project. Block one manually below, or import a list."
          }
          actionHref={q || reason !== "all" ? `/suppressions?project=${projectId}` : undefined}
          actionLabel={q || reason !== "all" ? "Clear filters" : undefined}
        />
      ) : (
        <>
          <div className="ds-table-shell">
            <div className="ds-table-scroll">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Suppressed address</th>
                    <th style={{ width: 190 }}>Reason</th>
                    <th style={{ width: 200 }}>Scope</th>
                    <th style={{ width: 140 }}>Blocked</th>
                    <th style={{ width: 150, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((r) => {
                    const meta = reasonMeta(r.reason);
                    return (
                      <tr key={r.id}>
                        <td>
                          <CopyableMono value={r.email} />
                        </td>
                        <td>
                          <span title={meta.hint}>
                            <StatusPill status={reasonPillStatus(r.reason)} label={meta.label} />
                          </span>
                        </td>
                        <td>
                          <span
                            className="mono"
                            style={{ fontSize: 11.5, color: "var(--color-muted)" }}
                          >
                            {meta.orgWide ? "Workspace-wide · all mail" : "This project · all mail"}
                          </span>
                        </td>
                        <td>
                          <RelativeTime value={r.createdAt.toISOString()} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <SuppressionRowAction
                            projectId={projectId}
                            row={{ id: r.id, email: r.email, reason: r.reason }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 14,
            }}
          >
            <span className="tabular-nums" style={{ fontSize: 12, color: "var(--color-muted)" }}>
              Showing {page.length} of {total.toLocaleString("en-US")}
            </span>
            {nextCursor && (
              <Link
                className="ds-btn ds-btn-secondary"
                style={{ textDecoration: "none" }}
                href={`/suppressions?${(() => {
                  const p = new URLSearchParams(filterQuery);
                  p.set("cursor", nextCursor);
                  return p.toString();
                })()}`}
              >
                Next page
              </Link>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <SuppressionAddPanel projectId={projectId} />
      </div>
    </div>
  );
}
