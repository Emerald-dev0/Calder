import Link from "next/link";
import { desc, eq, count, and } from "drizzle-orm";
import { getDb, emails, emailEvents, senderIdentities } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { SenderFilter } from "./sender-filter";
import { Mail, Send, KeyRound, ScrollText } from "lucide-react";
import { DsPageHeader, StatusPill } from "../../../components/design-system";
import { MessageExplorer } from "../../../components/message-explorer";

export default async function EmailsPage({
  searchParams,
}: {
  searchParams: { project?: string; sender?: string };
}) {
  const ctx = await getTenantContext();
  const scope = resolveProject(ctx, searchParams.project);
  if (!scope) {
    return (
      <div>
        <DsPageHeader
          icon={<Mail size={18} />}
          title="Emails & Message Explorer"
          description="No project found. Create a project in your organization settings to start sending."
        />
        <EmptyState
          title="No project found"
          description="Provision an organization and project to dispatch transactional emails."
          actionLabel="Configure workspace"
          actionHref="/settings#workspace"
        />
      </div>
    );
  }

  const db = getDb();
  const senders = await db
    .select({
      id: senderIdentities.id,
      displayName: senderIdentities.displayName,
      email: senderIdentities.email,
    })
    .from(senderIdentities)
    .where(eq(senderIdentities.projectId, scope.project.id));
  const senderFilter = searchParams.sender ?? "";
  const senderKnown = senderFilter === "" || senders.some((s) => s.id === senderFilter);
  const emailConds = [eq(emails.projectId, scope.project.id)];
  if (senderKnown && senderFilter !== "")
    emailConds.push(eq(emails.senderIdentityId, senderFilter));
  const rows = await db
    .select()
    .from(emails)
    .where(and(...emailConds))
    .orderBy(desc(emails.createdAt))
    .limit(50);
  const eventRows = await db
    .select({ emailId: emailEvents.emailId, value: count() })
    .from(emailEvents)
    .where(eq(emailEvents.projectId, scope.project.id))
    .groupBy(emailEvents.emailId);
  const eventCounts = new Map(eventRows.map((r) => [r.emailId, r.value]));

  const explorerRows = rows.map((e) => ({
    id: e.id,
    to: e.to,
    from: e.from,
    subject: e.subject,
    status: e.status,
    provider: e.provider,
    eventCount: eventCounts.get(e.id) ?? 0,
    createdAt: new Date(e.createdAt).toISOString(),
  }));

  return (
    <div>
      <DsPageHeader
        icon={<Mail size={18} />}
        title="Emails"
        badge={
          <StatusPill
            status="active"
            label={`${scope.organization.slug} / ${scope.project.slug}`}
          />
        }
        description="Every outbound send under this project—click any row to inspect its delivery timeline, SMTP headers, and raw payload."
        actions={
          <>
            <Link
              href={`/logs?project=${scope.project.id}`}
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <ScrollText size={14} />
              <span>Event stream</span>
            </Link>
            <Link
              href={`/keys?project=${scope.project.id}`}
              className="ds-btn ds-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <KeyRound size={14} />
              <span>API keys</span>
            </Link>
            <Link
              href={`/emails/new?project=${scope.project.id}`}
              className="ds-btn ds-btn-primary"
              style={{ textDecoration: "none" }}
            >
              <Send size={14} />
              <span>New email</span>
            </Link>
          </>
        }
      />

      {/* Project pills + Sender Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div className="ds-tabs" role="navigation" aria-label="Switch project">
          {ctx.memberships.flatMap((m) =>
            m.projects.map((p) => {
              const active = p.id === scope.project.id;
              return (
                <Link
                  key={p.id}
                  href={`/emails?project=${p.id}`}
                  className={`ds-tab ${active ? "is-active" : ""}`}
                >
                  {p.slug}
                </Link>
              );
            }),
          )}
        </div>

        {senders.length > 0 && (
          <SenderFilter
            projectId={scope.project.id}
            senders={senders}
            value={senderKnown ? senderFilter : ""}
          />
        )}
      </div>

      {explorerRows.length === 0 ? (
        <EmptyState
          icon={<Mail size={22} />}
          title={senderFilter ? "No emails from this sender yet" : "No emails sent yet"}
          description="Dispatch a message via the interactive composer or POST /v1/emails with a scoped API key. Real-time statuses, hops, and delivery logs appear here."
          actionLabel="Compose test email"
          actionHref={`/emails/new?project=${scope.project.id}`}
          secondaryLabel="View API keys"
          secondaryHref={`/keys?project=${scope.project.id}`}
        />
      ) : (
        <MessageExplorer rows={explorerRows} />
      )}
    </div>
  );
}
