import { desc, eq, inArray } from "drizzle-orm";
import { organizationMembers, organizations, projectTransports, projects, users } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtAgo } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { Badge, Dot, Empty, PageHeader, Panel, Planned } from "@/control/_components/ui";

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
        subtitle="Everything currently failing closed, and the ladder of controls available when something looks wrong."
      />

      <Panel
        title="Active restrictions"
        caption="suspended or revoked transports — send through them fails closed"
        flush
      >
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
                    <td>{r.organization.name}</td>
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

      <Panel title="Planned: enforcement actions" caption="the controls, wired to audit">
        <Planned
          title="Restriction controls"
          bullets={[
            "Warn (recorded, visible to the operator only)",
            "Rate limit a project to a fixed ceiling",
            "Require re-verification before further sends",
            "Pause sending per project or organization",
            "Suspend / restore with mandatory reason — all audit-logged with before/after",
          ]}
        >
          Transport suspension and restoration already exist as states (the worker fails closed on
          non-active transports); the operator UI to set them lands with the restrictions system so
          no one edits state by hand.{" "}
          <Badge tone="warn">Enforcement is code-level before it is UI-level.</Badge>
        </Planned>
      </Panel>
    </>
  );
}
