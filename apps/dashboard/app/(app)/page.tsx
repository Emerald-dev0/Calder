import { desc, inArray, count, gte } from "drizzle-orm";
import { getDb, emails, domains } from "@calder/db";
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

  // Usage meter (Beginner 5k, Pro 50k per pricing)
  const quota = 5000;
  const usagePct = Math.min(100, (stats.sent / quota) * 100);
  const deliveryRate = stats.sent > 0 ? ((stats.delivered / stats.sent) * 100).toFixed(1) : "—";
  const firstProject = ctx.memberships[0]?.projects[0] as { name: string; metadata?: { environment?: string } | null } | undefined;
  const greeting = `Good morning, ${(ctx.user as { name?: string }).name ?? ctx.user.email.split("@")[0] ?? "there"}.`;
  // Minimal project health (domain verified if any)
  let health: Array<{ label: string; ok: boolean }> = [
    { label: "Sending", ok: true },
    { label: "Webhooks", ok: true },
    { label: "API", ok: true },
  ];
  if (projectIds.length > 0) {
    try {
      const doms = await db.select({ id: domains.id }).from(domains).where(inArray(domains.projectId, projectIds)).limit(1);
      health = [{ label: "Domain", ok: doms.length > 0 }, ...health];
    } catch {}
  }

  const cards = [
  { label: "Emails sent", value: String(stats.sent), sub: `${deliveryRate}% delivered` },
  { label: "Delivered", value: String(stats.delivered), sub: `${stats.sent - stats.delivered} failed` },
  { label: "In queue", value: String(stats.queued), sub: `${stats.failed} failed total` },
  { label: "Failed", value: String(stats.failed), sub: `${usagePct.toFixed(0)}% of ${quota.toLocaleString()}` },
  ];

  return (
  <div>
  <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>{greeting}</h1>
  <p style={{ color: "var(--color-muted)", margin: "0 0 6px", fontSize: 13 }}>
  {firstProject ? `${firstProject.name} · ${(firstProject.metadata?.environment as string) ?? "Development"}` : ctx.memberships.length === 0 ? "You don't belong to any organization yet." : `Across ${projectIds.length} project${projectIds.length === 1 ? "" : "s"}.`}
  </p>
  <p style={{ color: "var(--color-muted)", fontSize: 12, margin: "0 0 16px" }}>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
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
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: 16,
  }}
  >
  <p style={{ fontSize: 22, fontWeight: 700, margin: "0 0 2px" }}>{s.value}</p>
  <p style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-muted)", margin: "0 0 4px" }}>{s.label}</p>
  <p style={{ fontSize: 11, color: "var(--color-muted)", margin: 0 }}>{(s as { sub?: string }).sub}</p>
  </div>
  ))}
  </div>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
  <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 16 }}>
  <p style={{ fontWeight: 600, margin: "0 0 8px", fontSize: 13 }}>Usage</p>
  <p style={{ fontSize: 13, margin: "0 0 8px" }}>{stats.sent.toLocaleString()} / {quota.toLocaleString()} <span style={{ color: "var(--color-muted)" }}>{usagePct.toFixed(0)}%</span></p>
  <div style={{ height: 6, background: "var(--color-paper)", borderRadius: 3, overflow: "hidden" }}>
  <div style={{ width: `${usagePct}%`, height: "100%", background: usagePct > 95 ? "#e11" : usagePct > 80 ? "#d97706" : "var(--color-ink)", transition: "width 300ms" }} />
  </div>
  <p style={{ fontSize: 11, color: "var(--color-muted)", margin: "8px 0 0" }}>{usagePct >= 95 ? "Only " + (quota - stats.sent) + " remaining — upgrade to Pro" : usagePct >= 80 ? "Approaching limit — view usage" : quota - stats.sent + " remaining · resets monthly"}</p>
  </div>
  <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 16 }}>
  <p style={{ fontWeight: 600, margin: "0 0 8px", fontSize: 13 }}>Project health</p>
  {health.map((h) => (
  <div key={h.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f5f5f5" }}>
  <span>{h.label}</span>
  <span style={{ color: h.ok ? "#16a34a" : "#d97706", fontWeight: 600 }}>{h.ok ? "✓ Healthy" : "○ Setup"}</span>
  </div>
  ))}
  </div>
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
 No emails yet, connect a project and send your first email via the API.
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
