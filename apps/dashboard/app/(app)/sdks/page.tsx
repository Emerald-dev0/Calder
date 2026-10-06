import Link from "next/link";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { ProjectPicker } from "../project-picker";
import { listTestKeys } from "../onboarding/actions";
import { SdkHub } from "./client";
import { Code2, KeyRound } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export const metadata = { title: "Calder — SDKs" };

export default async function SdksPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const projects = ctx.memberships.flatMap((m) => m.projects);
  const scope = resolveProject(ctx, query.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Code2 size={18} />}
          title="SDKs & Quickstarts"
          description="Create a project and integration snippets will appear here."
        />
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
      <DsPageHeader
        icon={<Code2 size={18} />}
        title="SDKs & Integration Quickstarts"
        badge={<StatusPill status="active" label="REST v1 + Official SDKs" />}
        description="Copy-ready snippets for Node.js, Python, Go, Ruby, PHP, and cURL with built-in Idempotency-Key headers."
        actions={
          <Link
            href={`/keys?project=${scope.project.id}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <KeyRound size={14} />
            <span>Manage API Keys</span>
          </Link>
        }
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/sdks"
      />
      <SdkHub projectId={scope.project.id} hasKeys={keys.length > 0} />
    </div>
  );
}
