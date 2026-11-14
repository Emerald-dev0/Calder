import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import {
  getDb,
  listInboundMessages,
  organizationForProject,
  organizationInboundUsage,
  receivingDomains,
} from "@calder/db";
import { getConfig } from "@calder/config";
import { Inbox, Paperclip } from "lucide-react";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { DsBanner, DsPageHeader, StatusPill } from "../../../components/design-system";
import { EmptyState } from "../../../components/empty-state";
import { ReceivingDomainAdder, ReceivingDomainRow } from "./manager";

/**
 * Receiving settings for one project.
 *
 * Three separate facts are shown as three separate things, because conflating
 * them is how "we configured inbound" turns into a false claim:
 *
 *   DNS verified   — the customer proved they own the name and MX points here.
 *   AWS recorded   — an operator created the SES receipt rule (we cannot).
 *   Accepting      — both of the above, so mail is actually being stored.
 *
 * Recent mail is listed from the same rows the inbox will read, so this page
 * cannot show a message the inbox would not have.
 */
export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const query = await searchParams;
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, query.project);
  const cfg = getConfig();

  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Inbox size={18} />}
          title="Receiving"
          description="No project found. Create a project first."
        />
        <EmptyState
          title="No project found"
          description="Receiving domains belong to a project. Create one in your workspace settings."
          actionLabel="Configure workspace"
          actionHref="/settings"
        />
      </div>
    );
  }

  const db = getDb();
  const projectId = scope.project.id;
  const [domains, recent, organizationId] = await Promise.all([
    db
      .select()
      .from(receivingDomains)
      .where(eq(receivingDomains.projectId, projectId))
      .orderBy(desc(receivingDomains.createdAt)),
    listInboundMessages(db, { projectId, limit: 10 }),
    organizationForProject(db, projectId),
  ]);
  const usage = organizationId ? await organizationInboundUsage(db, organizationId) : null;
  const canManage = scope.role === "owner" || scope.role === "admin";

  return (
    <div>
      <DsPageHeader
        icon={<Inbox size={18} />}
        title="Receiving"
        badge={
          <StatusPill
            status={domains.some((d) => d.status === "verified") ? "verified" : "pending"}
            label={`${domains.filter((d) => d.status === "verified").length} of ${domains.length} verified`}
          />
        }
        description="Accept mail for a domain or subdomain you own. Receiving is separate from sending: it has its own allowance and never consumes your outbound quota."
        actions={
          <ProjectPicker
            projects={ctx.memberships.flatMap((m) => m.projects)}
            currentId={projectId}
            basePath="/receiving"
          />
        }
      />

      {!cfg.INBOUND_ENABLED && (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="warning"
            title="Inbound email is not enabled on this deployment"
            description="Domains can be registered and DNS can be verified, but the API will not accept or store any mail until inbound infrastructure is configured (S3 bucket, SES receipt rule set, SNS topic and MX). Nothing you see here is a promise that mail is being received."
          />
        </div>
      )}

      <div className="ds-card" style={{ marginBottom: 20 }}>
        <div className="ds-card-body" style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Inbound this period</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {usage ? usage.received.toLocaleString("en-US") : "0"}
              <span style={{ fontSize: 13, opacity: 0.6 }}>
                {" "}
                / {usage?.limit === null ? "custom" : (usage?.limit ?? 0).toLocaleString("en-US")}
              </span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              {usage
                ? `${usage.tier === "free" ? "Beginner" : usage.tier} · counts only received mail`
                : ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Recent messages</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{recent.rows.length}</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>most recent 10, newest first</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>MX target</div>
            <div className="mono" style={{ fontSize: 13, marginTop: 6 }}>
              {cfg.INBOUND_MX_HOST}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>
              point a subdomain here, never a live mailbox
            </div>
          </div>
        </div>
      </div>

      {canManage ? (
        <ReceivingDomainAdder projectId={projectId} />
      ) : (
        <div style={{ marginBottom: 16 }}>
          <DsBanner
            tone="neutral"
            title="You can view but not change receiving settings"
            description="Only organisation owners and admins can add or verify receiving domains."
          />
        </div>
      )}

      {domains.length === 0 ? (
        <EmptyState
          title="No receiving domains yet"
          description="Add a domain or subdomain to start accepting mail into this project."
        />
      ) : (
        domains.map((domain) => (
          <ReceivingDomainRow
            key={domain.id}
            id={domain.id}
            domain={domain.domain}
            status={domain.status}
            mxHost={domain.mxHost}
            lastError={domain.lastError}
            provisioned={Boolean(domain.provisionedAt)}
            accepting={
              domain.status === "verified" && Boolean(domain.provisionedAt) && !domain.disabledAt
            }
          />
        ))
      )}

      <div className="ds-card" style={{ marginTop: 24 }}>
        <div className="ds-card-header">
          <div>
            <h2 className="ds-card-title">Recently received</h2>
            <p className="ds-card-subtitle">
              Stored messages for this project. Opening them in a shared inbox arrives with the
              Inbox release; the API already serves them at{" "}
              <code className="mono">GET /v1/inbound/messages</code>.
            </p>
          </div>
          <Link className="ds-btn ds-btn-ghost" href={`/logs?project=${projectId}`}>
            Delivery logs
          </Link>
        </div>
        <div className="ds-card-body">
          {recent.rows.length === 0 ? (
            <p style={{ opacity: 0.7, fontSize: 13, margin: 0 }}>
              Nothing received yet. Mail appears here as soon as a verified domain is accepting.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {recent.rows.map((row) => (
                <div
                  key={row.id}
                  style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}
                >
                  <StatusPill status={row.status} />
                  <strong style={{ fontSize: 13 }}>{row.subject ?? "(no subject)"}</strong>
                  <span className="mono" style={{ fontSize: 12, opacity: 0.75 }}>
                    {row.fromAddress ?? "unknown sender"}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.6 }}>
                    {row.receivedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                  </span>
                  {row.attachmentCount > 0 && (
                    <span style={{ fontSize: 12, opacity: 0.7, display: "inline-flex", gap: 4 }}>
                      <Paperclip size={12} /> {row.attachmentCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
