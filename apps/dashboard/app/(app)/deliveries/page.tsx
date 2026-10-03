import { and, desc, eq, ilike, inArray, count, or } from "drizzle-orm";
import { getDb, emails } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { EmptyState } from "../../../components/empty-state";
import {
  decodeCursor,
  cursorWhere,
  encodeCursor,
  stringParam,
  PAGE_SIZE,
} from "../../../lib/pagination";
import Link from "next/link";
import { Send, Search, ScrollText, ArrowRight } from "lucide-react";
import { DsPageHeader, StatusPill, StatCard } from "../../../components/design-system";
import { MessageExplorer } from "../../../components/message-explorer";

export const metadata = { title: "Calder — Deliveries" };

const STATUSES = new Set([
  "created",
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; cursor?: string; project?: string };
}) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) =>
    m.projects.map((p) => ({ id: p.id, slug: p.slug }))
  );
  const scope = resolveProject(ctx, searchParams.project);
  const current = scope?.project ?? null;
  const projectIds = current
    ? [current.id]
    : ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <DsPageHeader
          icon={<Send size={18} />}
          title="Deliveries"
          description="Delivery intelligence per sender, domain, and provider."
        />
        <EmptyState
          title="No project yet"
          description="Create a project and your deliveries will appear here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }
  const q = stringParam(searchParams.q);
  const statusParam = stringParam(searchParams.status);
  const statusFilter = statusParam && STATUSES.has(statusParam) ? statusParam : undefined;
  const cursor = decodeCursor(searchParams.cursor);

  const db = getDb();
  const conds = [inArray(emails.projectId, projectIds)];
  if (statusFilter)
    conds.push(eq(emails.status, statusFilter as (typeof emails.status.enumValues)[number]));
  if (q) conds.push(or(ilike(emails.to, `%${q}%`), ilike(emails.subject, `%${q}%`))!);
  const cw = cursorWhere(cursor, emails.createdAt, emails.id);
  if (cw) conds.push(cw);

  const rows = await db
    .select({
      id: emails.id,
      to: emails.to,
      subject: emails.subject,
      status: emails.status,
      from: emails.from,
      provider: emails.provider,
      createdAt: emails.createdAt,
    })
    .from(emails)
    .where(and(...conds))
    .orderBy(desc(emails.createdAt), desc(emails.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const lastRow = page[page.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id }) : null;
  const qs = (extra: Record<string, string | undefined>) =>
    "?" +
    Object.entries({ q, status: statusFilter, project: current?.id, ...extra })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");

  const byStatus = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(inArray(emails.projectId, projectIds))
    .groupBy(emails.status);
  const total = byStatus.reduce((n, r) => n + r.value, 0);
  const s = (name: string) => byStatus.find((r) => r.status === name)?.value ?? 0;
  const terminal = s("delivered") + s("bounced") + s("complained") + s("failed");
  const rate = terminal > 0 ? ((s("delivered") / terminal) * 100).toFixed(1) : "100.0";

  const filterBar = (
    <>
      {current ? (
        <ProjectPicker projects={projects} currentId={current.id} basePath="/deliveries" />
      ) : null}
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
        {current ? <input type="hidden" name="project" value={current.id} /> : null}
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
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
          placeholder="Search recipient address or subject line…"
          className="ds-input"
          style={{ paddingLeft: 32 }}
        />
      </div>
      <select
        name="status"
        defaultValue={statusFilter ?? ""}
        className="ds-select"
        style={{ width: "auto", minWidth: 160 }}
      >
        <option value="">All statuses</option>
        {[...STATUSES].map((st) => (
          <option key={st} value={st}>
            {st}
          </option>
        ))}
      </select>
      <button type="submit" className="ds-btn ds-btn-secondary">
        Apply filter
      </button>
      {(q || statusFilter) && (
        <Link
          href={`/deliveries${current ? `?project=${encodeURIComponent(current.id)}` : ""}`}
          className="ds-btn ds-btn-ghost ds-btn-sm"
          style={{ textDecoration: "none" }}
        >
          Clear
        </Link>
      )}
    </form>
    </>
  );

  const explorerRows = page.map((r) => ({
    id: r.id,
    to: r.to,
    from: r.from,
    subject: r.subject,
    status: r.status,
    provider: r.provider,
    createdAt: new Date(r.createdAt).toISOString(),
  }));

  return (
    <div>
      <DsPageHeader
        icon={<Send size={18} />}
        title="Deliveries"
        badge={<StatusPill status="delivered" label={`${rate}% terminal delivery`} />}
        description={`Delivery intelligence per sender, domain, and provider · ${total.toLocaleString()} total messages across all states.`}
        actions={
          <>
            <Link
              href="/logs"
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <ScrollText size={14} />
              <span>Raw event stream</span>
            </Link>
            <Link
              href="/emails/new"
              className="ds-btn ds-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <Send size={14} />
              <span>Send test email</span>
            </Link>
          </>
        }
      />

      <div className="ds-grid-4" style={{ marginBottom: 16 }}>
        <StatCard label="Total Dispatched" value={total.toLocaleString()} sub="All lifecycle states" />
        <StatCard
          label="Delivered"
          value={s("delivered").toLocaleString()}
          status="delivered"
          sub={`${rate}% of completed`}
        />
        <StatCard
          label="In Flight / Queued"
          value={(s("queued") + s("sending") + s("sent")).toLocaleString()}
          status="queued"
          sub="Awaiting remote MX 250 OK"
        />
        <StatCard
          label="Bounced / Failed"
          value={(s("bounced") + s("complained") + s("failed")).toLocaleString()}
          status={s("bounced") + s("failed") > 0 ? "bounced" : "healthy"}
          sub="Terminal delivery failures"
        />
      </div>

      {filterBar}

      {explorerRows.length === 0 ? (
        <EmptyState
          icon={<Send size={22} />}
          title={q || statusFilter ? "Nothing matches these filters" : "No deliveries yet"}
          description={
            q || statusFilter
              ? "Try widening your search query or clearing the status filter."
              : "Send your first email and inspect delivery rates, bounces, and provider hops here."
          }
          actionLabel={q || statusFilter ? "Clear filters" : "Compose test email"}
          actionHref={q || statusFilter ? "/deliveries" : "/emails/new"}
          secondaryLabel="View Emails"
          secondaryHref="/emails"
        />
      ) : (
        <MessageExplorer
          rows={explorerRows}
          footer={
            nextCursor ? (
              <Link
                href={`/deliveries${qs({ cursor: nextCursor })}`}
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <span>Older deliveries</span>
                <ArrowRight size={13} />
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
