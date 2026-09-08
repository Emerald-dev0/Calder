import { desc, inArray, count } from "drizzle-orm";
import { getDb, emails } from "@calder/db";
import { getTenantContext } from "../../lib/auth";

export default async function OverviewPage() {
  const ctx = await getTenantContext();
  const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
  const db = getDb();

  const stats = { sent: 0, delivered: 0, queued: 0, failed: 0 };
  let recent: Array<{ id: string; to: string; subject: string; status: string }> = [];
  if (projectIds.length > 0) {
    const byStatus = await db
      .select({ status: emails.status, value: count() })
      .from(emails)
      .where(inArray(emails.projectId, projectIds))
      .groupBy(emails.status);
    for (const row of byStatus) {
      if (row.status === "sent" || row.status === "delivered") {
        stats.sent += row.value;
        if (row.status === "delivered") stats.delivered += row.value;
      } else if (row.status === "queued" || row.status === "sending") {
        stats.queued += row.value;
      } else {
        stats.failed += row.value;
      }
    }
    recent = await db
      .select({ id: emails.id, to: emails.to, subject: emails.subject, status: emails.status })
      .from(emails)
      .where(inArray(emails.projectId, projectIds))
      .orderBy(desc(emails.createdAt))
      .limit(10);
  }

  const cards = [
    { label: "Emails sent", value: String(stats.sent) },
    { label: "Delivered", value: String(stats.delivered) },
    { label: "In queue", value: String(stats.queued) },
    { label: "Failed", value: String(stats.failed) },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Overview</h1>
      <p style={{ color: "#737373", margin: "0 0 24px" }}>
        {ctx.memberships.length === 0
          ? "You don't belong to any organization yet."
          : `Across ${projectIds.length} project${projectIds.length === 1 ? "" : "s"}.`}
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
        }}
      >
        {cards.map((s) => (
          <div
            key={s.label}
            style={{
              background: "#fff",
              border: "1px solid #E5E5E5",
              borderRadius: 12,
              padding: 20,
            }}
          >
            <p style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{s.value}</p>
            <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>{s.label}</p>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 24,
          background: "#fff",
          border: "1px solid #E5E5E5",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Recent activity</p>
        {recent.length === 0 ? (
          <p style={{ color: "#737373", fontSize: 14, margin: 0 }}>
            No emails yet — connect a project and send your first email via the API.
          </p>
        ) : (
          recent.map((e, i) => (
            <div
              key={e.id}
              style={{
                fontSize: 14,
                padding: "8px 0",
                borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>
                <b>{e.subject}</b> <span style={{ color: "#737373" }}>→ {e.to}</span>
              </span>
              <span className="mono" style={{ fontSize: 12, color: "#737373" }}>
                {e.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
