import { desc, inArray, count } from "drizzle-orm";
import { getDb, emails } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { EmptyState } from "../../../components/empty-state";

export const metadata = { title: "Calder — Deliveries" };

export default async function DeliveriesPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  if (projectIds.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Deliveries</h1>
        <EmptyState title="No project yet" description="Create a project and your deliveries will appear here." actionLabel="Create project" actionHref="/onboarding" />
      </div>
    );
  }
  const db = getDb();
  const rows = await db
    .select({ id: emails.id, to: emails.to, subject: emails.subject, status: emails.status, from: emails.from, provider: emails.provider, createdAt: emails.createdAt })
    .from(emails)
    .where(inArray(emails.projectId, projectIds))
    .orderBy(desc(emails.createdAt))
    .limit(20);

  const byStatus = await db
    .select({ status: emails.status, value: count() })
    .from(emails)
    .where(inArray(emails.projectId, projectIds))
    .groupBy(emails.status);
  const total = byStatus.reduce((n, r) => n + r.value, 0);
  const delivered = byStatus.find((r) => r.status === "sent" || r.status === "delivered")?.value ?? 0;
  const rate = total ? ((delivered / total) * 100).toFixed(1) : "—";

  if (rows.length === 0) {
    return (
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Deliveries</h1>
        <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Delivery intelligence per sender, domain, and provider. · {rate}% delivered</p>
        <EmptyState title="No deliveries yet" description="Send your first email and see delivery rate, bounces, and provider breakdown here. Filter by sender, status, and date." actionLabel="Go to Email" actionHref="/emails" />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Deliveries</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 12px" }}>
        {rate}% delivered · {total} total · Filter by sender, status, date coming next
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {byStatus.map((s) => (
          <span key={s.status} style={{ fontSize: 11, border: "1px solid var(--color-border)", padding: "4px 8px", borderRadius: 6, background: "#fff" }}>
            {s.status}: {s.value}
          </span>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.6fr 0.5fr", gap: 0, padding: "10px 14px", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-muted)", borderBottom: "1px solid var(--color-border)", background: "var(--color-paper)" }}>
          <span>Recipient / Subject</span>
          <span>From</span>
          <span>Status</span>
          <span>Provider</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 0.6fr 0.5fr", gap: 8, padding: "12px 14px", borderBottom: "1px solid #f5f5f5", fontSize: 13, alignItems: "center" }}>
            <span style={{ minWidth: 0 }}>
              <b style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.subject || "(no subject)"}</b>
              <span style={{ color: "var(--color-muted)", fontSize: 12 }}>{r.to}</span>
            </span>
            <span style={{ fontSize: 12, color: "var(--color-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.from}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: r.status === "sent" ? "#16a34a" : r.status === "failed" ? "#dc2626" : "var(--color-muted)" }}>{r.status}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--color-muted)" }}>{r.provider ?? "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
