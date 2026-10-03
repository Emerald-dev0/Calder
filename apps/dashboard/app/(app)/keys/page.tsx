import Link from "next/link";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { KeyCreator, RevokeButton } from "./manager";
import { listKeys } from "./actions";
import { KeyRound, Code2 } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  RelativeTime,
} from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";

export default async function KeysPage({ searchParams }: { searchParams: { project?: string } }) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<KeyRound size={18} />}
          title="API Keys"
          description="No project found. Complete onboarding first."
        />
        <EmptyState
          title="No project found"
          description="Create a project in your workspace settings to issue API keys."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }
  const keys = await listKeys(scope.project.id);
  const activeCount = keys.filter((k) => !k.revokedAt).length;

  return (
    <div>
      <DsPageHeader
        icon={<KeyRound size={18} />}
        title="API Keys"
        badge={<StatusPill status="active" label={`${activeCount} active`} />}
        description="Argon2id-hashed bearer credentials. Secrets are displayed once at creation and stored only by prefix; revocation takes effect immediately."
        actions={
          <Link
            href={`/sdks?project=${scope.project.id}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Code2 size={14} />
            <span>SDK Snippets</span>
          </Link>
        }
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/keys"
      />

      <KeyCreator projectId={scope.project.id} />

      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound size={22} />}
          title="No API keys issued yet"
          description="Create a test key above—it runs the full validation and queuing pipeline without delivering to external recipients."
        />
      ) : (
        <div className="ds-table-shell">
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key Prefix</th>
                  <th>Scope</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Last Used</th>
                  <th>Created</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}>{k.name}</td>
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          padding: "2px 7px",
                          borderRadius: 5,
                          background: "var(--color-surface-elevated)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {k.prefix}…
                      </span>
                    </td>
                    <td>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          padding: "2px 7px",
                          borderRadius: 999,
                          background: "var(--color-surface-elevated)",
                          border: "1px solid var(--color-border)",
                        }}
                      >
                        {k.scope ?? "full"}
                      </span>
                    </td>
                    <td>
                      <StatusPill status={k.env === "live" ? "live" : "test"} label={k.env} />
                    </td>
                    <td>
                      <StatusPill status={k.revokedAt ? "revoked" : "active"} />
                    </td>
                    <td>
                      <RelativeTime value={k.lastUsedAt} />
                    </td>
                    <td>
                      <RelativeTime value={k.createdAt} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {!k.revokedAt ? (
                        <RevokeButton projectId={scope.project.id} keyId={k.id} />
                      ) : (
                        <span className="mono" style={{ fontSize: 11.5, color: "var(--color-muted)" }}>
                          Revoked
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
