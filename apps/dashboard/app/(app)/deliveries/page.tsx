import { and, desc, eq, ilike, inArray, count, or } from "drizzle-orm";
import { getDb, emails } from "@calder/db";
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
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Deliveries</h1>
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
    Object.entries({ q, status: statusFilter, ...extra })
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
  // Honest rate: terminal sends only. In-flight mail is not delivered yet,
  // and "sent" (provider accepted) must not masquerade as delivered.
  const terminal = s("delivered") + s("bounced") + s("complained") + s("failed");
  const rate = terminal > 0 ? ((s("delivered") / terminal) * 100).toFixed(1) : "—";

  const statusColor: Record<string, string> = {
    delivered: "#16a34a",
    complained: "#dc2626",
    bounced: "#dc2626",
    failed: "#dc2626",
    sent: "#2563eb", // provider accepted, outcome not yet known
    sending: "#d97706",
    queued: "#d97706",
    created: "#d97706",
    suppressed: "var(--color-muted)",
  };

  const filterBar = (
    <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <input
        type="search"
        name="q"
        defaultValue={q ?? ""}
        placeholder="Search recipient or subject…"
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
        name="status"
        defaultValue={statusFilter ?? ""}
        style={{
          height: 38,
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          padding: "0 10px",
          fontSize: 13,
          background: "#fff",
        }}
      >
        <option value="">all statuses</option>
        {[...STATUSES].map((s) => (
          <option key={s} value={s}>
            {s}
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
  );

  if (rows.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Deliveries</h1>
        <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
          Delivery intelligence per sender, domain, and provider.
          {terminal > 0 ? ` · ${rate}% delivered of ${terminal} completed` : ""}
        </p>
        {filterBar}
        <EmptyState
          title={q || statusFilter ? "Nothing matches these filters" : "No deliveries yet"}
          description={
            q || statusFilter
              ? "Try widening the search or clearing the filters."
              : "Send your first email and see delivery rate, bounces, and provider breakdown here."
          }
          actionLabel={q || statusFilter ? "Clear filters" : "Go to Email"}
          actionHref={q || statusFilter ? "/deliveries" : "/emails"}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Deliveries</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        {rate}% delivered of {terminal} completed · {total} total, all states included
      </p>
      {filterBar}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {byStatus.map((s) => (
          <span
            key={s.status}
            style={{
              fontSize: 11,
              border: "1px solid var(--color-border)",
              padding: "4px 8px",
              borderRadius: 6,
              background: "#fff",
            }}
          >
            {s.status}: {s.value}
          </span>
        ))}
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr 0.6fr 0.5fr",
            gap: 0,
            padding: "10px 14px",
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--color-muted)",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-paper)",
          }}
        >
          <span>Recipient / Subject</span>
          <span>From</span>
          <span>Status</span>
          <span>Provider</span>
        </div>
        {page.map((r) => (
          <div
            key={r.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 0.8fr 0.6fr 0.5fr",
              gap: 8,
              padding: "12px 14px",
              borderBottom: "1px solid #f5f5f5",
              fontSize: 13,
              alignItems: "center",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <b
                style={{
                  display: "block",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.subject || "(no subject)"}
              </b>
              <span style={{ color: "var(--color-muted)", fontSize: 12 }}>{r.to}</span>
            </span>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.from}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: statusColor[r.status] ?? "var(--color-muted)",
              }}
            >
              {r.status}
            </span>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
              {r.provider ?? "—"}
            </span>
          </div>
        ))}
      </div>
      {nextCursor && (
        <p style={{ fontSize: 12, marginTop: 10 }}>
          <Link href={`/deliveries${qs({ cursor: nextCursor })}`}>older deliveries →</Link>
        </p>
      )}
    </div>
  );
}
