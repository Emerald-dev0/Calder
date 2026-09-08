import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { WebhookCreator, ToggleButton } from "./manager";
import { listWebhooks } from "./actions";

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Webhooks</h1>
        <p style={{ color: "#737373" }}>No project found. Complete onboarding first.</p>
      </div>
    );
  }
  const hooks = await listWebhooks(scope.project.id);

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Webhooks</h1>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        Signed, retried, replayable. Secrets are encrypted at rest.
      </p>
      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/webhooks"
      />
      <WebhookCreator projectId={scope.project.id} />
      <div
        style={{
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {hooks.length === 0 && (
          <p style={{ padding: 20, color: "#737373", fontSize: 14, margin: 0 }}>
            No endpoints yet.
          </p>
        )}
        {hooks.map((w, i) => (
          <div
            key={w.id}
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
              <b className="mono" style={{ fontSize: 13 }}>
                {w.url}
              </b>
              <div style={{ fontSize: 12, color: "#737373", marginTop: 2 }}>
                {w.events.join(" · ")}{" "}
                {!w.enabled && <b style={{ color: "#B45309" }}>· disabled</b>}
              </div>
            </div>
            <ToggleButton projectId={scope.project.id} webhookId={w.id} enabled={w.enabled} />
          </div>
        ))}
      </div>
    </div>
  );
}
