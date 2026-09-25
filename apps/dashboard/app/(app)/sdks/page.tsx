import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { listTestKeys } from "../onboarding/actions";
import { SdkHub } from "./client";

export const metadata = { title: "Calder — SDKs" };

export default async function SdksPage({
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
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>SDKs</h1>
        <EmptyState
          title="No project yet"
          description="Create a project and integration snippets will appear here."
          actionLabel="Create project"
          actionHref="/onboarding"
        />
      </div>
    );
  }
  const keys = await listTestKeys(scope.project.id);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>SDKs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        The API is plain HTTPS + JSON, so the snippets below are complete without any package
        install. Paste (or mint) a test key and they&rsquo;re copy-ready for your codebase.
      </p>
      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/sdks"
      />
      <SdkHub projectId={scope.project.id} hasKeys={keys.length > 0} />
    </div>
  );
}
