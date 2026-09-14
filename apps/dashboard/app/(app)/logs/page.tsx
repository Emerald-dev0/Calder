import { desc, inArray } from "drizzle-orm";
import { getDb, emails, emailEvents } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Logs" };

export default async function LogsPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Logs</h1>
        <EmptyState title="No project yet" description="Create a project and logs will appear here." actionLabel="Create project" actionHref="/onboarding" />
      </div>
    );
  }
  const db = getDb();
  const rows = await db
    .select({ id: emailEvents.id, emailId: emailEvents.emailId, type: emailEvents.type, createdAt: emailEvents.createdAt, data: emailEvents.data })
    .from(emailEvents)
    .where(inArray(emailEvents.projectId, projectIds))
    .orderBy(desc(emailEvents.createdAt))
    .limit(30);

  if (rows.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Logs</h1>
        <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Every request, queued to delivered, with request_id.</p>
        <EmptyState title="No events yet" description="Once your application sends its first message, its lifecycle — queued → provider → delivered — will appear here with request_id and message_id." actionLabel="Send test email" actionHref="/emails/new" />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Logs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>Search by request_id, recipient, subject — timeline per message.</p>
      <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
            <span>
              <b style={{ textTransform: "capitalize" }}>{r.type}</b> <span style={{ color: "var(--color-muted)" }}>· {r.emailId}</span>
            </span>
            <span className="mono" style={{ color: "var(--color-muted)" }}>
              {new Date(r.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 8 }}>Timeline: Request → Validated → Queued → Provider accepted → Delivered (truthful states, never fake Delivered).</p>
    </div>
  );
}
