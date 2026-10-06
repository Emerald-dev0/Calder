import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { getDb, domains, projectTransports } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { listSenders } from "./actions";
import { AddSender } from "./add-sender";
import { UserCheck, Globe, ArrowRight } from "lucide-react";
import {
  DsPageHeader,
  StatusPill,
  DsBanner,
  RelativeTime,
} from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Senders" };

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<UserCheck size={18} />}
          title="Sender Identities"
          description="No project found. Create one to add senders."
        />
        <EmptyState
          title="No project found"
          description="Create a project in your workspace settings to register sender identities."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const db = getDb();
  const senders = await listSenders(scope.project.id);
  const verifiedDomains = await db
    .select({ domain: domains.domain })
    .from(domains)
    .where(and(eq(domains.projectId, scope.project.id), eq(domains.status, "verified")));
  const gmailTransports = await db
    .select({
      id: projectTransports.id,
      label: projectTransports.label,
      dailyCap: projectTransports.dailyCap,
    })
    .from(projectTransports)
    .where(
      and(
        eq(projectTransports.projectId, scope.project.id),
        eq(projectTransports.type, "gmail"),
        eq(projectTransports.status, "active")
      )
    );

  const { gmailNeedsGraduation } = await import("@calder/db");
  const graduations = await Promise.all(
    gmailTransports.map(async (t) => ({
      ...t,
      signal: await gmailNeedsGraduation(db, scope.project.id, t.dailyCap),
    }))
  );
  const graduates = graduations.filter((g) => g.signal.needed);
  const verifiedCount = senders.filter(
    (s) => s.status === "verified" || s.status === "connected"
  ).length;

  return (
    <div>
      <DsPageHeader
        icon={<UserCheck size={18} />}
        title="Sender Identities"
        badge={
          <StatusPill
            status={verifiedCount > 0 ? "verified" : "pending"}
            label={
              senders.length === 0 ? "0 senders" : `${verifiedCount} of ${senders.length} ready`
            }
          />
        }
        description={`${scope.organization.name} → ${scope.project.name} · Manage verified From addresses and default project identities.`}
        actions={
          <Link
            href={`/domains?project=${scope.project.id}`}
            className="ds-btn ds-btn-secondary"
            style={{ textDecoration: "none" }}
          >
            <Globe size={14} />
            <span>Manage Domains</span>
          </Link>
        }
      />

      {graduates.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="warning"
            title={`You've outgrown Gmail (${graduates.map((g) => g.label).join(", ")})`}
            description={
              <span>
                This project is averaging{" "}
                <b>
                  {Math.max(...graduates.map((g) => Math.round(g.signal.dailyAvg7d)))} sends/day
                </b>{" "}
                through a personal Gmail account (cap {graduates[0]!.signal.cap}/day). Verify a
                custom domain to move onto production SES infrastructure automatically with zero
                code changes.
              </span>
            }
            action={
              <Link
                href="/domains"
                className="ds-btn ds-btn-secondary ds-btn-sm"
                style={{ textDecoration: "none" }}
              >
                <span>Verify domain →</span>
              </Link>
            }
          />
        </div>
      )}

      {senders.length === 0 ? (
        <EmptyState
          icon={<UserCheck size={22} />}
          title="No sender identities yet"
          description="Your application needs an authorized From address before Calder can deliver email. Verify your own domain or connect a Gmail account below."
          actionLabel="Verify a domain"
          actionHref={`/domains?project=${scope.project.id}`}
        />
      ) : (
        <div className="ds-table-shell" style={{ marginBottom: 20 }}>
          <div className="ds-table-scroll">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Display Name & Address</th>
                  <th style={{ width: 140 }}>Status</th>
                  <th style={{ width: 140 }}>Last Used</th>
                  <th style={{ width: 110, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {senders.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Link
                          href={`/senders/${s.id}?project=${scope.project.id}`}
                          style={{
                            fontWeight: 600,
                            fontSize: 13.5,
                            color: "var(--color-ink)",
                            textDecoration: "none",
                          }}
                        >
                          {s.displayName}
                        </Link>
                        {s.isDefault && <StatusPill status="active" label="Default" />}
                      </div>
                      <div className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                        {s.email}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={s.status} />
                    </td>
                    <td>
                      <RelativeTime value={s.lastUsedAt} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/senders/${s.id}?project=${scope.project.id}`}
                        className="ds-btn ds-btn-secondary ds-btn-sm"
                        style={{ textDecoration: "none" }}
                      >
                        <span>Manage</span>
                        <ArrowRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddSender
        projectId={scope.project.id}
        verifiedDomains={verifiedDomains.map((d) => d.domain)}
        gmailTransports={gmailTransports}
      />
    </div>
  );
}
