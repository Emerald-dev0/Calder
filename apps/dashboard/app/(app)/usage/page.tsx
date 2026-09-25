import { desc, inArray } from "drizzle-orm";
import { getDb, usageSummaries, plans, planPrices, orgUsageSnapshot } from "@calder/db";
import { planEmailsLimit, PLAN_LIMITS } from "@calder/config";
import { getTenantContext } from "../../../lib/auth";
import { pricingUrl } from "../../../lib/pricing";

export default async function UsagePage() {
  const ctx = await getTenantContext();
  const orgIds = ctx.memberships.map((m) => m.organization.id);
  const db = getDb();

  // Live quota state per membership org: accepted usage against the plan
  // limit for the CURRENT period (subscription period or UTC month), plus
  // the metered (delivered) total from the usage ledger. Never trust the
  // summary table alone — the cron may not have run since the last send.
  const snapshots = await Promise.all(
    ctx.memberships.map(async (m) => ({
      orgName: m.organization.name,
      orgId: m.organization.id,
      snap: await orgUsageSnapshot(db, m.organization.id),
    }))
  );
  const sentThisMonth = snapshots.reduce((n, s) => n + s.snap.acceptedLive, 0);

  const aggregated =
    orgIds.length > 0
      ? await db
          .select()
          .from(usageSummaries)
          .where(inArray(usageSummaries.organizationId, orgIds))
          .orderBy(desc(usageSummaries.periodStart))
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

      {snapshots.map(({ orgName, orgId, snap }) => {
        const limit = planEmailsLimit(snap.tier);
        const pct =
          limit === null ? 0 : Math.min(100, Math.round((snap.acceptedLive / limit) * 100));
        const hot = limit !== null && pct >= 90;
        const exhausted = limit !== null && snap.acceptedLive >= limit;
        return (
          <section
            key={orgId}
            style={{
              background: "#fff",
              border: `1px solid ${hot ? "#FCA5A5" : "#E5E5E5"}`,
              borderRadius: 12,
              padding: 20,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <p style={{ fontWeight: 700, margin: 0 }}>
                {orgName} <span style={{ color: "#737373", fontWeight: 400 }}>({snap.tier})</span>
              </p>
              <p style={{ margin: 0, fontSize: 14, color: exhausted ? "#B91C1C" : "#171717" }}>
                {exhausted ? "Limit reached — sends return plan_limit_reached · " : ""}
                {snap.acceptedLive.toLocaleString()} /{" "}
                {limit === null ? "custom" : limit.toLocaleString()} emails (
                {snap.metered.toLocaleString()} delivered)
              </p>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 5,
                background: "#F0F0F0",
                overflow: "hidden",
              }}
              role="progressbar"
              aria-valuenow={snap.acceptedLive}
              aria-valuemax={limit ?? undefined}
              aria-label={`Email usage for ${orgName}`}
            >
              <div
                style={{
                  height: "100%",
                  width: `${pct}%`,
                  background: exhausted ? "#B91C1C" : hot ? "#D97706" : "#171717",
                  transition: "width .3s",
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "#737373", margin: "8px 0 0" }}>
              Period {snap.period.start.toISOString().slice(0, 10)} →{" "}
              {snap.period.end.toISOString().slice(0, 10)} · test-key sends are never metered ·{" "}
              {exhausted ? (
                <>
                  <a href={pricingUrl()} style={{ color: "#B91C1C", textDecoration: "underline" }}>
                    Upgrade to keep sending
                  </a>{" "}
                  or wait for the period reset.
                </>
              ) : (
                <>
                  upgrade anytime on the{" "}
                  <a href={pricingUrl()} style={{ color: "inherit", textDecoration: "underline" }}>
                    pricing page
                  </a>
                  .
                </>
              )}
            </p>
          </section>
        );
      })}
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
                {(() => {
                  const q = Object.values(PLAN_LIMITS).find(
                    (l) => l.tier === t.tier
                  )?.emailsPerMonth;
                  return q === null || q === undefined
                    ? "Custom emails/mo"
                    : `${q.toLocaleString()} emails/mo`;
                })()}{" "}
                · hard limit enforced
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
