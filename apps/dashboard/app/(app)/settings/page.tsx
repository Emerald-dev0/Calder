import Link from "next/link";
import { getTenantContext } from "../../../lib/auth";
import { getTeam, listMySessions, requestDataExport } from "./actions";
import { InviteForm, MemberRow, RevokeInviteButton } from "./team";
import { NewOrgForm, NewProjectForm } from "./workspace-forms";
import { SessionsCard } from "./sessions";
import { EmailChangeForm } from "./account";
import { DsBanner } from "../../../components/design-system";
import { Settings, Building2, Users, Shield, CreditCard, FolderGit2, BellRing } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; emailChange?: string; dataExport?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const orgId = ctx.memberships.some((m) => m.organization.id === query.org)
    ? (query.org as string)
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
          <StatusPill status="active" label={`${team.organization.name} · ${team.callerRole}`} />
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
          <Link href="/settings/notifications" className="ds-tab" style={{ textDecoration: "none" }}>
            <BellRing size={13} />
            <span>Emails from Calder</span>
          </Link>
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
                  canTransfer={canAdminister && m.role !== "owner"}
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

      {emailChangeNotice(query.emailChange)}
      {query.dataExport === "sent" ? (
        <div style={{ marginTop: 4 }}>
          <DsBanner
            tone="info"
            title="Export link sent"
            description="Open it from your inbox within the next hour; you must be signed in for the download to work."
          />
        </div>
      ) : null}

      {/* Section: Active Sessions */}
      <div id="sessions">
        <SessionsCard sessions={mySessions} />
      </div>

      {/* Section: Account email */}
      <div id="account" style={{ marginTop: 20 }}>
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Account email</h2>
              <p className="ds-card-subtitle">
                Currently <span className="mono">{ctx.user.email}</span>. Changing it requires
                access to the current mailbox.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <EmailChangeForm currentEmail={ctx.user.email} />
          </div>
          <div className="ds-card-header" style={{ borderTop: "1px solid var(--color-border)" }}>
            <div>
              <h2 className="ds-card-title">Your data</h2>
              <p className="ds-card-subtitle">
                A JSON archive of your account, workspaces, projects, keys (prefixes only),
                senders, domains, audiences, contacts and message log.
              </p>
            </div>
          </div>
          <div className="ds-card-body">
            <form action={requestDataExport}>
              <button type="submit" className="ds-btn ds-btn-secondary">
                Email me a download link
              </button>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "8px 0 0" }}>
                The link works for one hour and requires you to be signed in.
              </p>
            </form>
          </div>
        </div>
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


/** Feedback for the email-change round trip (server action and confirm route). */
function emailChangeNotice(state: string | undefined) {
  if (!state) return null;
  const copy: Record<string, { tone: "success" | "danger" | "info"; title: string; body: string }> = {
    sent: {
      tone: "info",
      title: "Confirmation sent",
      body: "Open the link we sent to your current address. It expires in one hour; nothing has changed yet.",
    },
    done: {
      tone: "success",
      title: "Email address updated",
      body: "Both the old and the new address received a receipt. Use the new address to sign in from now on.",
    },
    invalid: {
      tone: "danger",
      title: "That address doesn't look right",
      body: "Enter a complete email address, for example you@company.com.",
    },
    same: {
      tone: "info",
      title: "That is already your address",
      body: "Enter a different address to start a change.",
    },
    taken: {
      tone: "danger",
      title: "That address is already in use",
      body: "Another Calder account owns it. Use a different address, or sign in to that account.",
    },
  };
  const entry = copy[state];
  if (!entry) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <DsBanner tone={entry.tone} title={entry.title} description={entry.body} />
    </div>
  );
}
