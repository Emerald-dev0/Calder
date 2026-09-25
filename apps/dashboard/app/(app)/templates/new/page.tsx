import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { EmptyState } from "../../../../components/empty-state";
import { TemplateEditor } from "../editor";

export const metadata = { title: "Calder — New template" };

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <EmptyState
        title="No project yet"
        description="Create a project before creating templates."
        actionLabel="Create project"
        actionHref="/onboarding"
      />
    );
  }
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>New template</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
        Saved as v1 on {scope.project.name}. Variables use {"{{name}}"} syntax; sends always take
        the latest version.
      </p>
      <TemplateEditor projectId={scope.project.id} mode="create" />
    </div>
  );
}
