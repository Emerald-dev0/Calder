import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getDb, emails, emailEvents } from "@calder/db";
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

/**
 * M5.1: real observability read. Search across recipient / email id / subject,
 * filter by event type, cursor-paginate. The WHERE always carries the tenant
 * project set before anything user-controlled is applied.
 */
export default async function LogsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; cursor?: string; project?: string };
}) {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Logs</h1>
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

  // Join emails so a "q" covers recipient + subject, not just opaque ids.
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
    Object.entries({ q, type: typeFilter, ...extra })
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Logs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        Every lifecycle event, searchable and paginated. Timeline per message on{" "}
        <Link href="/deliveries">Deliveries</Link>.
      </p>

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search recipient, subject, or email id…"
          style={{
            flex: 1,
            height: 38,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "0 12px",
            fontSize: 13,
          }}
        />
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          style={{
            height: 38,
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: "0 10px",
            fontSize: 13,
            background: "#fff",
          }}
        >
          <option value="">all types</option>
          {[...ALLOWED_TYPES].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
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
          title={q || typeFilter ? "No events match" : "No events yet"}
          description={
            q || typeFilter
              ? "Try widening the search or clearing the filter."
              : "Once your application sends its first message, its lifecycle — queued → provider → delivered — appears here."
          }
          actionLabel={q || typeFilter ? "Clear filters" : "Send test email"}
          actionHref={q || typeFilter ? "/logs" : "/emails/new"}
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
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: "1px solid #f5f5f5",
                  fontSize: 12,
                }}
              >
                <span>
                  <b style={{ textTransform: "capitalize" }}>{r.type}</b>{" "}
                  <span style={{ color: "var(--color-muted)" }}>
                    · {r.to ?? r.emailId}
                    {r.subject ? ` — ${r.subject.slice(0, 60)}` : ""}
                  </span>
                </span>
                <span className="mono" style={{ color: "var(--color-muted)", flexShrink: 0 }}>
                  {new Date(r.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 8 }}>
            Timeline: Request → Validated → Queued → Provider accepted → Delivered (truthful states,
            never fake Delivered).
            {nextCursor && (
              <>
                {" · "}
                <Link href={`/logs${qs({ cursor: nextCursor })}`}>older events →</Link>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
