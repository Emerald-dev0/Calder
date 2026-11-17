import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, ArrowLeftRight, ShieldAlert, Info } from "lucide-react";
import { getTenantContext } from "../../../../../../lib/auth";
import { DsBanner, DsPageHeader, StatusPill } from "../../../../../../components/design-system";
import { TransferError, previewProjectTransfer } from "../../../../../../lib/projects/transfer";
import { moveProjectAction } from "../../actions";

export const metadata = { title: "Calder — Move project" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(160px, 220px) 1fr",
        gap: 12,
        padding: "7px 0",
        borderBottom: "1px solid var(--color-border)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export default async function MoveProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ to?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await getTenantContext();

  const membership = ctx.memberships.find((m) => m.projects.some((p) => p.id === id));
  const project = membership?.projects.find((p) => p.id === id);
  if (!membership || !project) notFound();
  const sourceRole = membership.role;
  if (sourceRole !== "owner" && sourceRole !== "admin") {
    redirect("/settings/projects");
  }

  const memberships = ctx.memberships.map((m) => ({
    organizationId: m.organization.id,
    role: m.role,
  }));
  const destinations = ctx.memberships.filter(
    (m) =>
      m.organization.id !== membership.organization.id && (m.role === "owner" || m.role === "admin")
  );

  let preview = null;
  let previewError: string | null = null;
  if (query.to) {
    try {
      preview = await previewProjectTransfer({
        viewerUserId: ctx.user.userId,
        memberships,
        projectId: id,
        destinationOrganizationId: query.to,
      });
    } catch (err) {
      previewError = err instanceof TransferError ? err.message : "Could not prepare this move.";
    }
  }

  return (
    <div>
      <DsPageHeader
        icon={<ArrowLeftRight size={18} />}
        title={`Move ${project.name}`}
        badge={<StatusPill status="active" label={membership.organization.name} />}
        description="Move this project — with its domains, senders, keys and history — into another organisation you administer. Nothing is recreated and nothing is lost."
        actions={
          <Link
            href="/settings/projects"
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <span>All projects</span>
          </Link>
        }
      />

      {query.error || previewError ? (
        <DsBanner
          tone="danger"
          title="Nothing was moved"
          description={query.error ?? previewError ?? ""}
        />
      ) : null}

      {destinations.length === 0 ? (
        <DsBanner
          tone="info"
          title="No destination available"
          description="Moving a project needs an organisation where you are an owner or admin, other than the one it lives in now. Create another workspace, or ask an owner of the target workspace to make you an admin."
        />
      ) : !preview ? (
        <div className="ds-card">
          <div className="ds-card-header">
            <div>
              <h2 className="ds-card-title">Choose the destination</h2>
              <p className="ds-card-subtitle">
                You&rsquo;ll see exactly what moves and what doesn&rsquo;t before anything happens.
              </p>
            </div>
          </div>
          <div className="ds-card-body" style={{ display: "grid", gap: 8 }}>
            {destinations.map((m) => (
              <Link
                key={m.organization.id}
                href={`/settings/projects/${id}/move?to=${m.organization.id}`}
                className="ds-btn ds-btn-secondary"
                style={{ textDecoration: "none", justifyContent: "space-between" }}
              >
                <span>
                  {m.organization.name}{" "}
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>
                    · {m.role} · {m.projects.length} project{m.projects.length === 1 ? "" : "s"}
                  </span>
                </span>
                <ArrowRight size={14} />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="ds-card" style={{ marginBottom: 16 }}>
            <div className="ds-card-header">
              <div>
                <h2 className="ds-card-title">
                  {preview.source.name} → {preview.destination.name}
                </h2>
                <p className="ds-card-subtitle">
                  A confirmation, not a formality: this is the whole list of effects.
                </p>
              </div>
            </div>
            <div className="ds-card-body">
              <Row label="Project" value={<b>{preview.project.name}</b>} />
              <Row
                label="Slug"
                value={
                  <>
                    <span className="mono">{preview.project.slug}</span>
                    {preview.slugConflict ? (
                      <>
                        {" "}
                        → <span className="mono">{preview.resolvedSlug}</span>{" "}
                        <span style={{ color: "var(--color-warning)" }}>
                          (already taken in {preview.destination.name})
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--color-muted)" }}> (unchanged)</span>
                    )}
                  </>
                }
              />
              <Row
                label="Moving with it"
                value={`${preview.inventory.domains} domain${
                  preview.inventory.domains === 1 ? "" : "s"
                } (${preview.inventory.verifiedDomains} verified), ${preview.inventory.senders} sender${
                  preview.inventory.senders === 1 ? "" : "s"
                }, ${preview.inventory.apiKeys} live key${
                  preview.inventory.apiKeys === 1 ? "" : "s"
                }, ${preview.inventory.webhooks} webhook${
                  preview.inventory.webhooks === 1 ? "" : "s"
                }, ${preview.inventory.emails} sent email${
                  preview.inventory.emails === 1 ? "" : "s"
                }`}
              />
              <Row
                label="Destination plan"
                value={`${preview.destinationProjects.used} of ${
                  preview.destinationProjects.limit ?? "∞"
                } projects · ${preview.destinationDomains.used} of ${
                  preview.destinationDomains.limit ?? "∞"
                } domains`}
              />
              <Row
                label="Rewritten by the move"
                value={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {preview.rewritten.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                }
              />
              <Row
                label="Stays behind"
                value={
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {preview.staysBehind.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                }
              />
            </div>
          </div>

          {preview.blockers.length > 0 ? (
            <DsBanner
              tone="danger"
              title="This move can't go ahead"
              description={
                <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              }
            />
          ) : (
            <>
              <div className="ds-card" style={{ marginBottom: 16 }}>
                <div className="ds-card-header">
                  <div>
                    <h2 className="ds-card-title">
                      <ShieldAlert size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                      What changes for people
                    </h2>
                  </div>
                </div>
                <div className="ds-card-body">
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, lineHeight: 1.7 }}>
                    {preview.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="ds-card">
                <div className="ds-card-header">
                  <div>
                    <h2 className="ds-card-title">Confirm the move</h2>
                    <p className="ds-card-subtitle">
                      Type <span className="mono">{preview.project.name}</span> to confirm. The move
                      is atomic: if anything fails, the project stays exactly where it is.
                    </p>
                  </div>
                </div>
                <div className="ds-card-body">
                  <form
                    action={moveProjectAction}
                    style={{ display: "grid", gap: 10, maxWidth: 460 }}
                  >
                    <input type="hidden" name="projectId" value={preview.project.id} />
                    <input
                      type="hidden"
                      name="destinationOrganizationId"
                      value={preview.destination.id}
                    />
                    <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                      Project name
                      <input
                        name="confirmation"
                        className="ds-input"
                        autoComplete="off"
                        placeholder={preview.project.name}
                        required
                        style={{ marginTop: 6, width: "100%" }}
                      />
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="submit" className="ds-btn ds-btn-primary">
                        Move to {preview.destination.name}
                      </button>
                      <Link
                        href={`/settings/projects/${id}/move`}
                        className="ds-btn ds-btn-secondary"
                        style={{ textDecoration: "none" }}
                      >
                        Choose another destination
                      </Link>
                    </div>
                  </form>
                </div>
              </div>
            </>
          )}

          <p
            className="ds-caption"
            style={{ marginTop: 12, fontSize: 12.5, color: "var(--color-muted)" }}
          >
            <Info size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Both organisations get an audit entry naming you, the project and both workspace ids.
            API keys and DNS records are not touched, so integrations keep working through the move.
          </p>
        </>
      )}
    </div>
  );
}
