import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, domains } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { DomainAdder, DomainRow } from "./manager";
import { Globe, UserCheck } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";

export default async function DomainsPage({
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
        <DsPageHeader
          icon={<Globe size={18} />}
          title="Domains & DNS"
          description="No project found. Complete onboarding or create a project first."
        />
        <EmptyState
          title="No project found"
          description="Create a project in your workspace settings to verify sending domains."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(domains)
    .where(eq(domains.projectId, scope.project.id))
    .orderBy(desc(domains.createdAt));

  const verifiedCount = rows.filter((d) => d.status === "verified").length;

  return (
    <div>
      <DsPageHeader
        icon={<Globe size={18} />}
        title="Domains & DNS Authentication"
        badge={
          <StatusPill
            status={verifiedCount > 0 ? "verified" : "pending"}
            label={`${verifiedCount} of ${rows.length} verified`}
          />
        }
        description="Authenticate your sending domains with 2048-bit RSA DKIM, SPF, and DMARC records for maximum inbox placement."
        actions={
          <Link
            href={`/senders?project=${scope.project.id}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <UserCheck size={14} />
            <span>Sender Identities</span>
          </Link>
        }
      />

      <ProjectPicker
        projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
        currentId={scope.project.id}
        basePath="/domains"
      />

      <DomainAdder projectId={scope.project.id} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Globe size={22} />}
          title="No sending domains registered yet"
          description="Add your root domain or subdomain above, publish the generated TXT and CNAME records in your DNS provider, and start sending authenticated mail."
        />
      ) : (
        <div>
          {rows.map((d) => (
            <DomainRow
              key={d.id}
              domain={{
                id: d.id,
                domain: d.domain,
                status: d.status,
                verification:
                  d.status !== "verified" &&
                  d.status !== "expired" &&
                  d.verificationToken &&
                  d.verificationToken.startsWith("cvt_")
                    ? {
                        host: `_calder.${d.domain}`,
                        value: `calder-verification=${d.verificationToken}`,
                        expiresAt: d.verificationExpiresAt?.toISOString() ?? null,
                      }
                    : null,
                dkimRecords: d.dkimRecords ?? [],
                dkimStatus: d.dkimStatus,
                sesIdentityStatus: d.sesIdentityStatus,
                lastVerifyError: d.lastVerifyError,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
