import { desc, eq, count, and } from "drizzle-orm";
import { getDb, emails, emailEvents, senderIdentities } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";
import { SenderFilter } from "./sender-filter";

const STATUS_COLORS: Record<string, string> = {
  queued: "#B45309",
  sending: "#1E3A8A",
  sent: "#16A34A",
  delivered: "#16A34A",
  bounced: "#DC2626",
  complained: "#DC2626",
  failed: "#DC2626",
  suppressed: "#737373",
};

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
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Emails</h1>
        <p style={{ color: "#737373" }}>No project found. Create one to start sending.</p>
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Emails</h1>
        <span className="mono" style={{ fontSize: 12, color: "#737373" }}>
          {scope.organization.slug} / {scope.project.slug}
        </span>
        <a
          href={`/emails/new?project=${scope.project.id}`}
          style={{
            marginLeft: "auto",
            background: "#0B0C0E",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          New email
        </a>
      </div>
      <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
        Every send under this project, including mail Calder sends to itself.
      </p>
      {ctx.memberships.flatMap((m) =>
        m.projects.map((p) => (
          <a
            key={p.id}
            href={`/emails?project=${p.id}`}
            style={{
              display: "inline-block",
              fontSize: 13,
              marginRight: 8,
              marginBottom: 16,
              padding: "6px 12px",
              borderRadius: 999,
              textDecoration: "none",
              border: "1px solid #E5E5E5",
              background: p.id === scope.project.id ? "#0B0C0E" : "#fff",
              color: p.id === scope.project.id ? "#fff" : "#0B0C0E",
            }}
          >
            {p.slug}
          </a>
        ))
      )}
      {senders.length > 0 && (
        <SenderFilter
          projectId={scope.project.id}
          senders={senders}
          value={senderKnown ? senderFilter : ""}
        />
      )}
      {rows.length === 0 ? (
        <EmptyState
          title={senderFilter ? "No emails from this sender yet" : "No emails sent yet"}
          description="Send via POST /v1/emails with an API key and real-time events, statuses, and delivery logs will appear here."
          actionLabel="View API keys"
          actionHref={`/keys?project=${scope.project.id}`}
        />
      ) : (
        <div
          style={{
            background: "#fff",
            border: "1px solid #E5E5E5",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {rows.map((e, i) => (
            <div
              key={e.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 4,
                padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
                fontSize: 14,
              }}
            >
              <div>
                <span style={{ fontWeight: 600 }}>{e.subject}</span>{" "}
                <span style={{ color: "#737373" }}>
                  → {e.to} ·{" "}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {e.id}
                  </span>{" "}
                  · {eventCounts.get(e.id) ?? 0} events
                </span>
              </div>
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 12,
                  color: STATUS_COLORS[e.status] ?? "#737373",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {e.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
