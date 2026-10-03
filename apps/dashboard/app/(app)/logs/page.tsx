import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getDb, emails, emailEvents } from "@calder/db";
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
import { ScrollText, Search, Send, ArrowRight } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
  CopyableMono,
} from "../../../components/design-system";

export const metadata = { title: "Calder — Logs" };

const ALLOWED_TYPES = new Set([
  "created",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "opened",
  "clicked",
  "suppressed",
]);

export default async function LogsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; cursor?: string; project?: string };
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
          icon={<ScrollText size={18} />}
          title="Delivery Event Logs"
          description="Real-time lifecycle event stream across all projects."
        />
        <EmptyState
          title="No project yet"
          description="Create a project and logs will appear here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }

  const q = stringParam(searchParams.q);
  const type = stringParam(searchParams.type);
  const typeFilter = type && ALLOWED_TYPES.has(type) ? type : undefined;
  const cursor = decodeCursor(searchParams.cursor);

  const db = getDb();
  const conds = [inArray(emailEvents.projectId, projectIds)];
  if (typeFilter)
    conds.push(eq(emailEvents.type, typeFilter as (typeof emailEvents.type.enumValues)[number]));
  const cw = cursorWhere(cursor, emailEvents.createdAt, emailEvents.id);
  if (cw) conds.push(cw);

  const base = db
    .select({
      id: emailEvents.id,
      emailId: emailEvents.emailId,
      type: emailEvents.type,
      createdAt: emailEvents.createdAt,
      to: emails.to,
      subject: emails.subject,
    })
    .from(emailEvents)
    .leftJoin(emails, eq(emailEvents.emailId, emails.id));

  const qConds = q
    ? [
        ilike(emails.to, `%${q}%`),
        ilike(emails.subject, `%${q}%`),
        ilike(emailEvents.emailId, `%${q}%`),
      ]
    : [];
  const rows = await base
    .where(and(...conds, ...(qConds.length ? [or(...qConds)] : [])))
    .orderBy(desc(emailEvents.createdAt), desc(emailEvents.id))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
  const qs = (extra: Record<string, string | undefined>) =>
    "?" +
    Object.entries({ q, type: typeFilter, project: current?.id, ...extra })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");

  return (
    <div>
      <DsPageHeader
        icon={<ScrollText size={18} />}
        title="Delivery Event Logs"
        badge={<StatusPill status="active" label="Live Stream" />}
        description={
          <span>
            Every lifecycle event (`created → queued → sent → delivered`), searchable and cursor-paginated. View message-grouped timelines on{" "}
            <Link href="/deliveries" style={{ color: "var(--color-accent)", fontWeight: 600 }}>
              Deliveries
            </Link>
            .
          </span>
        }
        actions={
          <>
            <Link
              href="/deliveries"
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <span>Message Explorer</span>
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

      {current ? (
        <ProjectPicker projects={projects} currentId={current.id} basePath="/logs" />
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
            placeholder="Search recipient, subject, or message ID…"
            className="ds-input"
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          className="ds-select"
          style={{ width: "auto", minWidth: 160 }}
        >
          <option value="">All event types</option>
          {[...ALLOWED_TYPES].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className="ds-btn ds-btn-secondary">
          Filter
        </button>
        {(q || typeFilter) && (
          <Link
            href="/logs"
            className="ds-btn ds-btn-ghost ds-btn-sm"
            style={{ textDecoration: "none" }}
          >
            Clear
          </Link>
        )}
      </form>

      {page.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={22} />}
          title={q || typeFilter ? "No events match" : "No events yet"}
          description={
            q || typeFilter
              ? "Try widening the search or clearing the event type filter."
              : "Once your application sends its first message, its lifecycle — queued → provider → delivered — appears here in real time."
          }
          actionLabel={q || typeFilter ? "Clear filters" : "Send test email"}
          actionHref={q || typeFilter ? "/logs" : "/emails/new"}
        />
      ) : (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Event Type</th>
                  <th>Recipient & Subject</th>
                  <th style={{ width: 200 }}>Message ID</th>
                  <th style={{ width: 130, textAlign: "right" }}>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {page.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <StatusPill status={r.type} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {r.to ?? "Unknown recipient"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        {r.subject ? r.subject.slice(0, 80) : "—"}
                      </div>
                    </td>
                    <td>
                      <CopyableMono value={r.emailId} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <RelativeTime value={r.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ds-card-footer" style={{ justifyContent: "space-between" }}>
            <span style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
              Pipeline: Request → Validated → Queued → Provider accepted → Delivered (truthful states only).
            </span>
            {nextCursor && (
              <Link
                href={`/logs${qs({ cursor: nextCursor })}`}
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <span>Older events</span>
                <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
