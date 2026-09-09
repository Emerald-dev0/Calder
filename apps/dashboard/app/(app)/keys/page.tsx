import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { KeyCreator, RevokeButton } from "./manager";
import { listKeys } from "./actions";

export default async function KeysPage({ searchParams }: { searchParams: { project?: string } }) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>API keys</h1>
        <p style={{ color: "#737373" }}>No project found. Complete onboarding first.</p>
      </div>
    );
  }
  const keys = await listKeys(scope.project.id);

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>API keys</h1>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        Secrets show once, then live on as prefixes. Revocation is immediate.
      </p>
      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/keys"
      />
      <KeyCreator projectId={scope.project.id} />
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {keys.length === 0 && (
          <p style={{ padding: 20, color: "#737373", fontSize: 14, margin: 0 }}>
            No keys yet. Create a test key above — it runs the full pipeline with nothing actually
            delivered.
          </p>
        )}
        {keys.map((k, i) => (
          <div
            key={k.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
              fontSize: 14,
            }}
          >
            <div>
              <b>{k.name}</b>{" "}
              <span className="mono" style={{ fontSize: 12, color: "#737373" }}>
                {k.prefix}… · {k.env}
              </span>
              {k.revokedAt && (
                <span style={{ fontSize: 12, color: "#DC2626", marginLeft: 8 }}>revoked</span>
              )}
            </div>
            {!k.revokedAt && <RevokeButton projectId={scope.project.id} keyId={k.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
