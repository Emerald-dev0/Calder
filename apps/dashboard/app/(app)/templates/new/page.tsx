import Link from "next/link";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { EmptyState } from "../../../../components/empty-state";
import { TemplateEditor } from "../editor";
import { FileCode2, ArrowLeft } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";

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
      <DsPageHeader
        icon={<FileCode2 size={18} />}
        title="New Template"
        badge={<StatusPill status="active" label={`v1 · ${scope.project.name}`} />}
        description="Variables use {{name}} syntax; sends always resolve the latest immutable version."
        actions={
          <Link
            href={`/templates?project=${encodeURIComponent(scope.project.id)}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            <span>Back to Templates</span>
          </Link>
        }
      />
      <TemplateEditor projectId={scope.project.id} mode="create" />
    </div>
  );
}
