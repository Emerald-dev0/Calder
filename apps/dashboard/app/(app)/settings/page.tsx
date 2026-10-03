import Link from "next/link";
import { getTenantContext } from "../../../lib/auth";
import { getTeam, listMySessions } from "./actions";
import { InviteForm, MemberRow, RevokeInviteButton } from "./team";
import { NewOrgForm, NewProjectForm } from "./workspace-forms";
import { SessionsCard } from "./sessions";
import {
  Settings,
  Building2,
  Users,
  Shield,
  CreditCard,
  FolderGit2,
} from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export default async function SettingsPage({ searchParams }: { searchParams: { org?: string } }) {
  const ctx = await getTenantContext();
  const orgId = ctx.memberships.some((m) => m.organization.id === searchParams.org)
    ? (searchParams.org as string)
    : (ctx.memberships[0]?.organization.id ?? null);

  if (!orgId) {
    return (
      <div>
        <DsPageHeader
          icon={<Settings size={18} />}
          title="Workspace Settings"
          description="You don't belong to an organization yet. Create your first organization below."
        />
        <div className="ds-card" id="workspace">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Create Your Organization</h2>
              <p className="ds-card-subtitle">
                Organizations own projects, verified domains, API keys, and billing quotas.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <NewOrgForm />
          </div>
        </div>
      </div>
    );
  }

  const team = await getTeam(orgId);
  const mySessions = await listMySessions();
  if (!team.organization) {
    return (
      <div>
        <DsPageHeader
          icon={<Settings size={18} />}
          title="Settings"
          description="Organization not found."
        />
      </div>
    );
  }
  const canManage = team.callerRole === "owner" || team.callerRole === "admin";
  const canAdminister = team.callerRole === "owner";
  const pending = team.invites.filter((i) => !i.acceptedAt && !i.expired);

  return (
    <div>
      <DsPageHeader
        icon={<Settings size={18} />}
        title="Organization & Security Settings"
        badge={
          <StatusPill
            status="active"
            label={`${team.organization.name} · ${team.callerRole}`}
          />
        }
        description="Manage workspace hierarchy, team roles, operator sessions, and billing quotas."
        actions={
          <Link
            href="/usage"
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <CreditCard size={14} />
            <span>Billing & Usage</span>
          </Link>
        }
      />

      {/* Sub-navigation bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div className="ds-tabs" role="navigation" aria-label="Settings sections">
          <a href="#team" className="ds-tab is-active" style={{ textDecoration: "none" }}>
            <Users size={13} />
            <span>Team ({team.members.length})</span>
          </a>
          <a href="#sessions" className="ds-tab" style={{ textDecoration: "none" }}>
            <Shield size={13} />
            <span>Sessions ({mySessions.length})</span>
          </a>
          <a href="#workspace" className="ds-tab" style={{ textDecoration: "none" }}>
            <Building2 size={13} />
            <span>Workspace & Projects</span>
          </a>
        </div>

        {ctx.memberships.length > 1 && (
          <div className="ds-tabs" role="navigation" aria-label="Switch organization">
            {ctx.memberships.map((m) => (
              <Link
                key={m.organization.id}
                href={`/settings?org=${m.organization.id}`}
                className={`ds-tab ${m.organization.id === orgId ? "is-active" : ""}`}
              >
                {m.organization.slug}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Section: Team & Invitations */}
      <div id="team" style={{ marginBottom: 20 }}>
        <InviteForm orgId={orgId} canManage={canManage} />

        <div className="ds-card">
          <div className="ds-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={15} style={{ color: "var(--color-accent)" }} />
              <h2 className="ds-card-title">Organization Members ({team.members.length})</h2>
            </div>
          </div>
          <div>
            {team.members.map((m, i) => (
              <div
                key={m.id}
                style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border)" }}
              >
                <MemberRow
                  orgId={orgId}
                  member={m}
                  isSelf={m.userId === team.callerUserId}
                  canAdminister={canAdminister}
                />
              </div>
            ))}
          </div>
        </div>

        {pending.length > 0 && (
          <div className="ds-card" style={{ marginTop: 16 }}>
            <div className="ds-card-header">
              <h2 className="ds-card-title">Pending Invitations ({pending.length})</h2>
            </div>
            <div>
              {pending.map((inv, i) => (
                <div
                  key={inv.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
                    fontSize: 13.5,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mono">{inv.email}</span>
                    <StatusPill status="pending" label={inv.role} />
                  </div>
                  {canManage && <RevokeInviteButton orgId={orgId} inviteId={inv.id} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section: Active Sessions */}
      <div id="sessions">
        <SessionsCard sessions={mySessions} />
      </div>

      {/* Section: Workspace & Projects */}
      <div id="workspace" className="ds-grid-2">
        <div className="ds-card">
          <div className="ds-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Building2 size={15} style={{ color: "var(--color-accent)" }} />
              <div>
                <h2 className="ds-card-title">Create New Organization</h2>
                <p className="ds-card-subtitle">
                  Provision a separate tenant boundary with its own billing and team
                </p>
              </div>
            </div>
          </div>
          <div className="ds-card-body">
            <NewOrgForm />
          </div>
        </div>

        <div className="ds-card">
          <div className="ds-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FolderGit2 size={15} style={{ color: "var(--color-accent)" }} />
              <div>
                <h2 className="ds-card-title">Create New Project</h2>
                <p className="ds-card-subtitle">
                  Isolate API keys, webhooks, and templates by environment
                </p>
              </div>
            </div>
          </div>
          <div className="ds-card-body">
            {canManage ? (
              <NewProjectForm
                orgs={ctx.memberships
                  .filter((m) => m.role === "owner" || m.role === "admin")
                  .map((m) => ({ id: m.organization.id, name: m.organization.name }))}
              />
            ) : (
              <p style={{ fontSize: 13, color: "var(--color-muted)", margin: 0 }}>
                Only organization owners and admins can create projects.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
