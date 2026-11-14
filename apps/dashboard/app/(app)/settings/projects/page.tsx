import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderGit2, ArrowRight, Plus } from "lucide-react";
import { getTenantContext } from "../../../../lib/auth";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";

export const metadata = { title: "Calder — Projects" };

/**
 * Project settings index.
 *
 * Until now the dashboard had no per-project settings surface at all, which is
 * where the "move a project" workflow has to live: an action that changes an
 * organisation's ownership of something needs a page that says what it will do.
 */
export default async function ProjectsSettingsPage() {
  const ctx = await getTenantContext();
  const organization = ctx.active.organization;
  if (!organization) redirect("/settings");

  const membership = ctx.memberships.find((m) => m.organization.id === organization.id);
  const projects = membership?.projects ?? [];
  const role = membership?.role ?? "member";
  const canManage = role === "owner" || role === "admin";
  const otherOrganizations = ctx.memberships.filter((m) => m.organization.id !== organization.id);

  return (
    <div>
      <DsPageHeader
        icon={<FolderGit2 size={18} />}
        title="Projects"
        badge={<StatusPill status="active" label={`${organization.name} · ${role}`} />}
        description={`Applications and environments in ${organization.name}. A project owns its domains, senders, API keys and delivery history.`}
        actions={
          <Link
            href="/settings#workspace"
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Plus size={14} />
            <span>New project</span>
          </Link>
        }
      />

      {projects.length === 0 ? (
        <div className="ds-card">
          <div className="ds-card-body">
            <p style={{ margin: 0, fontWeight: 600 }}>No projects in this organisation yet.</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-muted)" }}>
              Create one from the workspace card in settings. A project is what API keys, domains
              and senders belong to.
            </p>
          </div>
        </div>
      ) : (
        <div className="ds-card" style={{ overflow: "hidden" }}>
          <table className="ds-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Slug</th>
                <th>Environment</th>
                <th style={{ textAlign: "right" }}>Manage</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <b>{project.name}</b>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                      {project.slug}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5, color: "var(--color-muted)" }}>
                    {project.metadata?.environment ?? "development"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {canManage ? (
                      <Link
                        href={`/settings/projects/${project.id}/move`}
                        className="ds-btn ds-btn-ghost ds-btn-sm"
                        style={{ textDecoration: "none" }}
                      >
                        <span>Move to another organisation</span>
                        <ArrowRight size={13} />
                      </Link>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        Owners and admins only
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p
        className="ds-caption"
        style={{ marginTop: 12, fontSize: 12.5, color: "var(--color-muted)" }}
      >
        {canManage
          ? otherOrganizations.length === 0
            ? "You belong to one organisation, so there is nowhere to move a project yet. Create or join another workspace to transfer one."
            : `You can move a project into ${otherOrganizations
                .map((m) => m.organization.name)
                .join(", ")} — or any workspace where you are an owner or admin.`
          : "Moving a project between organisations needs owner or admin rights in both the source and the destination."}
      </p>
    </div>
  );
}
