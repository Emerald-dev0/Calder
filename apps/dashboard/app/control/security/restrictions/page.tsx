import { desc, eq, inArray } from "drizzle-orm";
import { organizationMembers, organizations, projectTransports, projects, users } from "@calder/db";
import { getDb } from "@calder/db";
import Link from "next/link";
import { fmtAgo } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { Dot, Empty, PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function RestrictionsPage() {
  await requireSection("security");
  const db = getDb();
  const restricted = await db
    .select({
      transport: projectTransports,
      project: projects,
      organization: organizations,
    })
    .from(projectTransports)
    .innerJoin(projects, eq(projectTransports.projectId, projects.id))
    .innerJoin(organizations, eq(projects.organizationId, organizations.id))
    .where(inArray(projectTransports.status, ["suspended", "revoked"]))
    .orderBy(desc(projectTransports.updatedAt))
    .limit(20);
  const ownerIds = restricted.map((r) => r.organization.id);
  const owners = ownerIds.length
    ? await db
        .select({ organizationId: organizationMembers.organizationId, email: users.email })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(inArray(organizationMembers.organizationId, ownerIds))
    : [];
  const ownerByOrg = new Map(owners.map((o) => [o.organizationId, o.email]));

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Restrictions"
        subtitle="Active transport restrictions from durable state. Broader enforcement controls are gated until wired to real, audited actions."
      />

      <Panel title="Active restrictions" caption="Suspended/revoked transports fail closed" flush>
        {restricted.length === 0 ? (
          <Empty title="No active restrictions">Every transport is active.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Transport</th>
                  <th>Project</th>
                  <th>Organization</th>
                  <th>Owner</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {restricted.map((r) => (
                  <tr key={r.transport.id}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Dot tone={r.transport.status === "suspended" ? "warn" : "bad"} />{" "}
                        {r.transport.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {r.transport.type} · {r.transport.label}
                    </td>
                    <td>{r.project.name}</td>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        {r.organization.name}
                      </Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {ownerByOrg.get(r.organization.id) ?? "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(r.transport.updatedAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Gated capability" caption="Operator enforcement UI">
        <Planned
          state="gated"
          title="Restriction controls"
          bullets={[
            "Per-project/org rate limits and pause actions with mandatory reason",
            "Server-enforced permissions and audit log for every change",
            "Clear before/after state and rollback/restore path",
          ]}
        >
          Gmail suspended transports can be reactivated from the Abuse page where authorized.
          Broader restriction controls remain gated until fully implemented.
        </Planned>
      </Panel>
    </>
  );
}
