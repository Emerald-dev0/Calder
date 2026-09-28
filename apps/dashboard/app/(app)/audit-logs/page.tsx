import { and, desc, eq, ilike, inArray } from "drizzle-orm";
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

export const metadata = { title: "Calder — Audit Logs" };

/**
 * M5.1: the tenant-side audit view. Reads the same `audit_logs` rows the
 * control plane writes — scoped to the caller's project set, filterable by
 * action, cursor-paginated. There is no plan gating on your own audit trail.
 */
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
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Audit Logs</h1>
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
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Audit Logs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        Security-relevant events across your projects: keys, domains, senders, webhook changes,
        abuse actions. Written by the system, not by dashboards.
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          name="action"
          defaultValue={actionFilter ?? ""}
          placeholder="Filter by action (e.g. api_key, domain, transport)…"
          style={{
            flex: 1,
            maxWidth: 420,
            height: 38,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "0 12px",
            fontSize: 13,
          }}
        />
        <button
          type="submit"
          style={{
            height: 38,
            padding: "0 16px",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            background: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Filter
        </button>
      </form>

      {page.length === 0 ? (
        <EmptyState
          title={actionFilter ? "No events match" : "No audit events yet"}
          description={
            actionFilter
              ? "Try another action filter."
              : "Events appear as keys rotate, domains verify, and transports change state."
          }
          actionLabel={actionFilter ? "Clear filter" : undefined}
          actionHref={actionFilter ? "/audit-logs" : undefined}
        />
      ) : (
        <>
          <div
            style={{
              background: "#fff",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {page.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  padding: "10px 14px",
                  borderBottom: "1px solid #f5f5f5",
                  fontSize: 12.5,
                  alignItems: "center",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <b className="mono" style={{ fontSize: 12 }}>
                    {r.action}
                  </b>{" "}
                  <span style={{ color: "var(--color-muted)" }}>
                    · {r.targetType ?? "—"} {r.targetId ? `(${r.targetId})` : ""}
                  </span>
                  {r.metadata && Object.keys(r.metadata).length > 0 && (
                    <span
                      className="mono"
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--color-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        marginTop: 2,
                      }}
                    >
                      {JSON.stringify(r.metadata)}
                    </span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                  {new Date(r.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
          {nextCursor && (
            <p style={{ fontSize: 12, marginTop: 10 }}>
              <Link href={`/audit-logs${qs({ cursor: nextCursor })}`}>older events →</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
