import Link from "next/link";
import { fmtAgo, fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { projectRows } from "@/lib/control/queries";
import { Empty, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await requireSection("customers");
  const rows = await projectRows();

  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Projects"
        subtitle="Every sending surface customers operate, across all organizations. Transport, volume, and last activity at a glance."
      />

      <Panel title="All projects" caption={`${fmtInt(rows.length)} projects · newest first`} flush>
        {rows.length === 0 ? (
          <Empty title="No projects yet" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Organization</th>
                  <th>Emails</th>
                  <th>Transports</th>
                  <th>Last send</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.project.id}>
                    <td>
                      {r.project.name}{" "}
                      <span className="mono" style={{ fontSize: 11, color: "var(--cp-faint)" }}>
                        {r.project.slug}
                      </span>
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>{r.organization.name}</Link>
                    </td>
                    <td className="cp-num">{fmtInt(Number(r.emails))}</td>
                    <td className="cp-num">{fmtInt(Number(r.transports))}</td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {r.lastSend ? fmtAgo(new Date(r.lastSend)) : "never"}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(r.project.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
