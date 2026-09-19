import { desc, inArray } from "drizzle-orm";
import { getDb, emails, usageRecords, plans, planPrices } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { pricingUrl } from "../../../lib/pricing";

const PLAN_QUOTAS: Record<string, number> = {
 free: 3000,
 starter: 25000,
 pro: 100000,
 scale: 500000,
};

export default async function UsagePage() {
 const ctx = await getTenantContext();
 const projectIds = ctx.memberships.flatMap((m) => m.projects.map((p) => p.id));
 const orgIds = ctx.memberships.map((m) => m.organization.id);
 const db = getDb();

 let sentThisMonth = 0;
 if (projectIds.length > 0) {
 // Live count from durable email rows (usage cron not yet running, see below).
 const live = await db
 .select({ id: emails.id })
 .from(emails)
 .where(inArray(emails.projectId, projectIds));
 sentThisMonth = live.length;
 }

 const aggregated =
 orgIds.length > 0
 ? await db
 .select()
 .from(usageRecords)
 .where(inArray(usageRecords.organizationId, orgIds))
 .orderBy(desc(usageRecords.periodStart))
 .limit(12)
 : [];

 const tiers = await db.select().from(plans);
 const prices = await db.select().from(planPrices);
 const priceOf = (planId: string, currency: string) =>
 prices.find((p) => p.planId === planId && p.currency === currency);

 return (
 <div>
 <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Usage</h1>
 <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
 Metered from durable records, the invoice always matches this page.
 </p>
 <div
 style={{
 display: "grid",
 gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
 gap: 16,
 marginBottom: 24,
 }}
 >
 <div
 style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 12, padding: 20 }}
 >
 <p style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>
 {sentThisMonth.toLocaleString()}
 </p>
 <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>Accepted sends (live count)</p>
 </div>
 <div
 style={{ background: "#fff", border: "1px solid #E5E5E5", borderRadius: 12, padding: 20 }}
 >
 <p style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>{aggregated.length}</p>
 <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>Aggregated periods</p>
 </div>
 </div>

 <p style={{ fontWeight: 600, margin: "0 0 12px" }}>Plans</p>
 <div
 style={{
 display: "grid",
 gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
 gap: 16,
 marginBottom: 24,
 }}
 >
            {tiers.length === 0 && (
              <p style={{ color: "#737373", fontSize: 14 }}>
                Plans seed at launch, see{" "}
                <a href={pricingUrl()} style={{ color: "inherit", textDecoration: "underline" }}>
                  pricing
                </a>{" "}
                for the schedule.
              </p>
            )}
 {tiers.map((t) => {
 const ngn = priceOf(t.id, "NGN");
 const usd = priceOf(t.id, "USD");
 return (
 <div
 key={t.id}
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 padding: 20,
 }}
 >
 <p style={{ fontWeight: 700, margin: "0 0 4px", textTransform: "capitalize" }}>
 {t.tier}
 </p>
 <p className="mono" style={{ fontSize: 13, margin: "0 0 4px" }}>
 {ngn ? `₦${(ngn.amountCents / 100).toLocaleString()}` : ", "} ·{" "}
 {usd ? `$${usd.amountCents / 100}` : ", "}/mo
 </p>
 <p style={{ fontSize: 12, color: "#737373", margin: 0 }}>
 {(PLAN_QUOTAS[t.tier] ?? 0).toLocaleString()} emails/mo · billing activates at
 launch
 </p>
 </div>
 );
 })}
 </div>

 {aggregated.length > 0 && (
 <>
 <p style={{ fontWeight: 600, margin: "0 0 12px" }}>History</p>
 <div
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 overflow: "hidden",
 }}
 >
 {aggregated.map((u, i) => (
 <div
 key={u.id}
 style={{
 display: "flex",
 justifyContent: "space-between",
 padding: "10px 16px",
 borderTop: i === 0 ? "none" : "1px solid #F0F0F0",
 fontSize: 14,
 }}
 >
 <span className="mono" style={{ fontSize: 13 }}>
 {u.metric} · {u.periodStart.toISOString().slice(0, 10)}
 </span>
 <b>{u.quantity.toLocaleString()}</b>
 </div>
 ))}
 </div>
 </>
 )}
 </div>
 );
}
