import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderGit2, ArrowRight, Plus } from "lucide-react";
import { getDb, projects as projectsTable } from "@calder/db";
import { asc, eq } from "drizzle-orm";
import { getTenantContext } from "../../../../lib/auth";
import { cancelProjectDeletionAction, requestProjectDeletionAction } from "./actions";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";

export const metadata = { title: "Calder — Projects" };

/**
 * Project settings index.
 *
 * Until now the dashboard had no per-project settings surface at all, which is
 * where the "move a project" workflow has to live: an action that changes an
 * organisation's ownership of something needs a page that says what it will do.
 */
export default async function ProjectsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ deletion?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const organization = ctx.active.organization;
  if (!organization) redirect("/settings");

  const membership = ctx.memberships.find((m) => m.organization.id === organization.id);
  // Read from the table rather than the cached context: the context carries only
  // id/name/slug, and whether a project is mid-deletion is exactly what this
  // page has to show before someone tries to send from it.
  const projects = await getDb()
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      slug: projectsTable.slug,
      metadata: projectsTable.metadata,
      deletionScheduledFor: projectsTable.deletionScheduledFor,
    })
    .from(projectsTable)
    .where(eq(projectsTable.organizationId, organization.id))
    .orderBy(asc(projectsTable.createdAt));
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

      <ProjectDeletionNotice state={query.deletion} />

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
                <th>Deletion</th>
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
                  <td>
                    {project.deletionScheduledFor ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <StatusPill
                          status="pending"
                          label={`purge ${project.deletionScheduledFor.toISOString().slice(0, 10)}`}
                        />
                        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
                          Sending stopped.
                        </span>
                        {canManage ? (
                          <form action={cancelProjectDeletionAction}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <button type="submit" className="ds-btn ds-btn-sm">
                              Keep it
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : canManage ? (
                      <form
                        action={requestProjectDeletionAction}
                        style={{ display: "flex", gap: 6, alignItems: "center" }}
                      >
                        <input type="hidden" name="projectId" value={project.id} />
                        <input
                          className="ds-input"
                          name="confirmation"
                          placeholder={project.slug}
                          autoComplete="off"
                          spellCheck={false}
                          style={{ maxWidth: 120, fontSize: 12 }}
                          aria-label={`Type ${project.slug} to delete it`}
                        />
                        <button
                          type="submit"
                          className="ds-btn ds-btn-sm"
                          style={{ color: "#B4433A" }}
                        >
                          Delete
                        </button>
                      </form>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-muted)" }}>Owners only</span>
                    )}
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

/**
 * Refusals from the deletion form, in the page's own words. A wrong slug is a
 * normal outcome, so it gets a line of text rather than an error boundary.
 */
function ProjectDeletionNotice({ state }: { state: string | undefined }) {
  if (!state) return null;
  const copy: Record<string, { tone: "success" | "danger" | "info"; title: string; body: string }> =
    {
      requested: {
        tone: "success",
        title: "Project scheduled for deletion",
        body: "Sending from this project has stopped. Cancel any time before the purge date.",
      },
      cancelled: {
        tone: "info",
        title: "Project deletion cancelled",
        body: "Nothing was destroyed.",
      },
      confirmation_mismatch: {
        tone: "danger",
        title: "That did not match",
        body: "Type the project slug exactly as shown — nothing was scheduled.",
      },
      forbidden: {
        tone: "danger",
        title: "Not allowed",
        body: "Only an owner or admin of this workspace can delete a project.",
      },
      organization_pending_deletion: {
        tone: "info",
        title: "The whole workspace is scheduled for deletion",
        body: "Cancel or complete that request in Settings instead.",
      },
      not_scheduled: {
        tone: "info",
        title: "Nothing to cancel",
        body: "That project is not scheduled for deletion.",
      },
      error: {
        tone: "danger",
        title: "That did not work",
        body: "Nothing was deleted. Try again, or contact support.",
      },
    };
  const entry = copy[state];
  if (!entry) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <DsBannerMarker tone={entry.tone} title={entry.title} body={entry.body} />
    </div>
  );
}

function DsBannerMarker({
  tone,
  title,
  body,
}: {
  tone: "success" | "danger" | "info";
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--color-border)",
        background:
          tone === "danger"
            ? "rgba(190, 60, 50, 0.08)"
            : tone === "success"
              ? "rgba(40, 140, 90, 0.08)"
              : "rgba(70, 110, 190, 0.08)",
        fontSize: 13,
      }}
    >
      <b style={{ display: "block", marginBottom: 2 }}>{title}</b>
      <span style={{ color: "var(--color-muted)" }}>{body}</span>
    </div>
  );
}
