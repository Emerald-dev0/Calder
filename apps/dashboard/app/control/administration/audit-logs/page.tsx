import Link from "next/link";
import { fmtDateTime, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { auditRows } from "@/lib/control/queries";
import { Empty, PageHeader, Panel, Pager } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  await requireSection("administration");
  const page = Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1);
  const data = await auditRows({ q: searchParams.q, page });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Audit Logs"
        subtitle="Every important internal action: actor, action, target, timestamp, and metadata. Non-negotiable — plan changes, grants, restrictions, broadcasts all land here."
      />

      <Panel title="Trail" caption={`${fmtInt(data.total)} recorded actions · newest first`} flush>
        <form className="cp-filters" method="get" style={{ padding: "12px 16px 0" }}>
          <input
            className="cp-input"
            type="search"
            name="q"
            placeholder="Filter by action or target id…"
            defaultValue={searchParams.q ?? ""}
            style={{ minWidth: 260 }}
          />
          <button className="cp-btn primary" type="submit">
            Filter
          </button>
          {searchParams.q ? (
            <Link className="cp-btn" href="/control/administration/audit-logs">
              Clear
            </Link>
          ) : null}
        </form>

        {data.rows.length === 0 ? (
          <Empty title="Nothing recorded yet">
            Operator actions appear here automatically — inviting teammates, changing plans,
            granting roles, managing the waitlist.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Metadata</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ audit: a, actorEmail }) => (
                  <tr key={a.id}>
                    <td style={{ color: "var(--cp-muted)" }}>{actorEmail ?? "system"}</td>
                    <td className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {a.action}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {a.targetType ?? "—"}
                      {a.targetId ? ` · ${a.targetId.slice(0, 22)}` : ""}
                    </td>
                    <td
                      className="mono wrap"
                      style={{
                        fontSize: 11.5,
                        color: "var(--cp-faint)",
                        whiteSpace: "normal",
                        maxWidth: 320,
                      }}
                    >
                      {a.metadata ? JSON.stringify(a.metadata).slice(0, 120) : "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtDateTime(new Date(a.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          basePath="/control/administration/audit-logs"
          query={{ q: searchParams.q }}
        />
      </Panel>
    </>
  );
}
