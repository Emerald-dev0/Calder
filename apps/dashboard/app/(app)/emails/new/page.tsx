import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, senderIdentities } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../../lib/auth";
import { Composer } from "./composer";
import { Send, ArrowLeft } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../../components/design-system";
import { EmptyState } from "../../../../components/empty-state";

export const metadata = { title: "Calder — New email" };

export default async function NewEmailPage({
  searchParams,
}: {
  searchParams: { project?: string };
}) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Send size={18} />}
          title="Compose Email"
          description="No project found. Create a project to start sending."
        />
        <EmptyState
          title="No project found"
          description="Provision an organization and project to dispatch emails."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: senderIdentities.id,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
      status: senderIdentities.status,
      isDefault: senderIdentities.isDefault,
    })
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, scope.project.id));
  const def =
    rows.find((r) => r.isDefault) ??
    rows.find((r) => r.status === "verified" || r.status === "connected") ??
    null;

  return (
    <div>
      <DsPageHeader
        icon={<Send size={18} />}
        title="Compose & Send Email"
        badge={
          <StatusPill
            status="active"
            label={`${scope.organization.name} · ${scope.project.name}`}
          />
        }
        description="Dispatch a live or sandbox test email with full DKIM signing and real-time event tracking."
        actions={
          <Link
            href={`/emails?project=${scope.project.id}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <ArrowLeft size={14} />
            <span>Back to Emails</span>
          </Link>
        }
      />

      <Composer
        projectId={scope.project.id}
        senders={rows.map((r) => ({
          id: r.id,
          displayName: r.displayName,
          email: r.email,
          status: r.status,
          isDefault: r.isDefault,
        }))}
        defaultSenderId={def?.id ?? null}
      />
    </div>
  );
}
