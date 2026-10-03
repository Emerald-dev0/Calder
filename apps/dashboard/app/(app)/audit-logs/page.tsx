import { and, desc, ilike, inArray } from "drizzle-orm";
import { getDb, auditLogs } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import {
  decodeCursor,
  cursorWhere,
  encodeCursor,
  stringParam,
  PAGE_SIZE,
} from "../../../lib/pagination";
import Link from "next/link";
import { History, Search, ArrowRight } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
} from "../../../components/design-system";

export const metadata = { title: "Calder — Audit Logs" };

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { action?: string; cursor?: string };
}) {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <DsPageHeader
          icon={<History size={18} />}
          title="Audit Logs"
          description="Immutable security trail across your projects."
        />
        <EmptyState
          title="No project yet"
          description="Create a project and security events will be logged here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }

  const actionFilter = stringParam(searchParams.action);
  const cursor = decodeCursor(searchParams.cursor);
  const db = getDb();

  const conds = [inArray(auditLogs.projectId, projectIds)];
  if (actionFilter) conds.push(ilike(auditLogs.action, `%${actionFilter}%`));
  const cw = cursorWhere(cursor, auditLogs.createdAt, auditLogs.id);
  if (cw) conds.push(cw);

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  const qs = (extra: Record<string, string | undefined>) =>
    "?" +
    Object.entries({ action: actionFilter, ...extra })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");

  return (
    <div>
      <DsPageHeader
        icon={<History size={18} />}
        title="Audit Logs"
        badge={<StatusPill status="active" label="Immutable Trail" />}
        description="Security-relevant events across your projects: API keys, domains, senders, webhook changes, and abuse guard actions."
      />

      <form
        method="get"
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 440 }}>
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
            name="action"
            defaultValue={actionFilter ?? ""}
            placeholder="Filter by action (e.g. api_key, domain, transport)…"
            className="ds-input"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <button type="submit" className="ds-btn ds-btn-secondary">
          Filter
        </button>
        {actionFilter && (
          <Link
            href="/audit-logs"
            className="ds-btn ds-btn-ghost ds-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Clear
          </Link>
        )}
      </form>

      {page.length === 0 ? (
        <EmptyState
          icon={<History size={22} />}
          title={actionFilter ? "No events match" : "No audit events yet"}
          description={
            actionFilter
              ? "Try another action filter."
              : "Events appear automatically as API keys rotate, domains verify, and transports change state."
          }
          actionLabel={actionFilter ? "Clear filter" : undefined}
          actionHref={actionFilter ? "/audit-logs" : undefined}
        />
      ) : (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Action</th>
                  <th style={{ width: 220 }}>Target Resource</th>
                  <th>Metadata</th>
                  <th style={{ width: 140, textAlign: "right" }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "2px 7px",
                          borderRadius: 5,
                          background: "var(--color-surface-elevated)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {r.action}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--color-ink-secondary)" }}>
                      {r.targetType ?? "—"} {r.targetId ? `(${r.targetId.slice(0, 14)})` : ""}
                    </td>
                    <td>
                      {r.metadata && Object.keys(r.metadata).length > 0 ? (
                        <code
                          className="mono"
                          style={{
                            fontSize: 11.5,
                            color: "var(--color-muted)",
                            display: "block",
                            maxWidth: 420,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {JSON.stringify(r.metadata)}
                        </code>
                      ) : (
                        <span style={{ color: "var(--color-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <RelativeTime value={r.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div className="ds-card-footer">
              <Link
                href={`/audit-logs${qs({ cursor: nextCursor })}`}
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <span>Older events</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
