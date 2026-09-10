import { getTenantContext } from "../../../lib/auth";
import { getTeam } from "./actions";
import { InviteForm, MemberRow, RevokeInviteButton } from "./team";
import { NewOrgForm, NewProjectForm } from "./workspace-forms";

export default async function SettingsPage({ searchParams }: { searchParams: { org?: string } }) {
  const ctx = await getTenantContext();
  const orgId = ctx.memberships.some((m) => m.organization.id === searchParams.org)
    ? (searchParams.org as string)
    : (ctx.memberships[0]?.organization.id ?? null);
  if (!orgId) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Settings</h1>
        <p style={{ color: "#737373" }}>No organization found.</p>
      </div>
    );
  }
  const team = await getTeam(orgId);
  if (!team.organization) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Settings</h1>
        <p style={{ color: "#737373" }}>Organization not found.</p>
      </div>
    );
  }
  const canManage = team.callerRole === "owner" || team.callerRole === "admin";
  const canAdminister = team.callerRole === "owner";
  const pending = team.invites.filter((i) => !i.acceptedAt && !i.expired);

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Settings</h1>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        {team.organization.name} · your role: <b>{team.callerRole}</b>
      </p>
      <div style={{ marginBottom: 16 }}>
        {ctx.memberships.map((m) => (
          <a
            key={m.organization.id}
            href={`/settings?org=${m.organization.id}`}
            style={{
              display: "inline-block",
              fontSize: 13,
              marginRight: 8,
              padding: "6px 12px",
              borderRadius: 999,
              textDecoration: "none",
              border: "1px solid #E5E5E5",
              background: m.organization.id === orgId ? "#0B0C0E" : "#fff",
              color: m.organization.id === orgId ? "#fff" : "#0B0C0E",
            }}
          >
            {m.organization.slug}
          </a>
        ))}
      </div>

      <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Team ({team.members.length})</p>
      <InviteForm orgId={orgId} canManage={canManage} />
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 20,
        }}
      >
        {team.members.map((m, i) => (
          <div key={m.id} style={{ borderTop: i === 0 ? "none" : "1px solid #F0F0F0" }}>
            <MemberRow
              orgId={orgId}
              member={m}
              isSelf={m.userId === team.callerUserId}
              canAdminister={canAdminister}
            />
          </div>
        ))}
      </div>

      <p style={{ fontWeight: 600, margin: "24px 0 12px" }} id="workspace">
        Workspace
      </p>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          padding: 16,
          marginBottom: 8,
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>New organization</p>
        <NewOrgForm />
        <p style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px" }}>New project</p>
        {canManage ? (
          <NewProjectForm
            orgs={ctx.memberships
              .filter((m) => m.role === "owner" || m.role === "admin")
              .map((m) => ({ id: m.organization.id, name: m.organization.name }))}
          />
        ) : (
          <p style={{ fontSize: 13, color: "#737373", margin: 0 }}>
            Only owners and admins can create projects.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <>
          <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Pending invites ({pending.length})</p>
          <div
            style={{
              background: "#fff",
              border: "1px solid #E5E5E5",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {pending.map((inv, i) => (
              <div
                key={inv.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
                  fontSize: 14,
                }}
              >
                <span>
                  {inv.email} <span style={{ color: "#737373", fontSize: 13 }}>· {inv.role}</span>
                </span>
                {canManage && <RevokeInviteButton orgId={orgId} inviteId={inv.id} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
