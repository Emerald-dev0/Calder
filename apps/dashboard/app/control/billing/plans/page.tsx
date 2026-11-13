import { asc, eq } from "drizzle-orm";
import { plans, planPrices, subscriptions } from "@calder/db";
import { getDb } from "@calder/db";
import { COMMERCIAL_PLAN_ORDER, PLAN_LIMITS, formatUsdCents, planFor } from "@calder/config";
import { fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { Badge, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  await requireSection("billing");
  const db = getDb();
  const [planRows, priceRows, activeSubs] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.createdAt)),
    db.select().from(planPrices),
    db
      .select({ planId: subscriptions.planId })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active")),
  ]);
  const activeByPlan = new Map<string, number>();
  for (const s of activeSubs) activeByPlan.set(s.planId, (activeByPlan.get(s.planId) ?? 0) + 1);

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Plans"
        subtitle="The pricing hypothesis as it actually exists in the database. No value is hardcoded anywhere else — plans are configuration, and this is the catalog."
      />

      <div className="cp-stats">
        <Stat label="Plans" value={fmtInt(planRows.length)} hint="free → scale" />
        <Stat label="Prices" value={fmtInt(priceRows.length)} hint="per-currency records" />
        <Stat label="Active subs" value={fmtInt(activeSubs.length)} hint="across all tiers" />
      </div>

      <div className="cp-grid cp-grid-3">
        {planRows.map((p) => {
          const prices = priceRows.filter((pr) => pr.planId === p.id);
          return (
            <Panel key={p.id} title={p.name} caption={`tier: ${p.tier} · id: ${p.id}`}>
              {prices.map((pr) => (
                <div className="cp-kv" key={pr.id}>
                  <span className="k">
                    {pr.currency} / {pr.interval}
                  </span>
                  <span className="v mono">
                    {fmtMoney(pr.amountCents, pr.currency as "NGN" | "USD")}
                  </span>
                </div>
              ))}
              <div className="cp-kv">
                <span className="k">Active subscriptions</span>
                <span className="v mono">{fmtInt(activeByPlan.get(p.id) ?? 0)}</span>
              </div>
              <div className="cp-kv">
                <span className="k">Sold at checkout</span>
                <span className="v mono">
                  {planFor(p.tier).retired ? (
                    <Badge tone="warn">retired</Badge>
                  ) : p.tier === "free" ? (
                    <Badge>included</Badge>
                  ) : (
                    formatUsdCents(PLAN_LIMITS[planFor(p.tier).tier].price.USD ?? 0)
                  )}
                </span>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Plan controls" caption="what a price change actually does">
        <div style={{ padding: "12px 16px 16px", fontSize: 13, lineHeight: 1.7 }}>
          <p style={{ marginTop: 0 }}>
            Two values have to agree before a customer is charged the number you expect:
          </p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
            <li>
              <b>The catalogue row above</b> (database) decides what the product enforces — the
              monthly allowance, daily cap, seats and sender limits.
            </li>
            <li>
              <b>The USD list price in configuration</b> plus the Paystack plan code (
              <span className="mono">PAYSTACK_PLAN_STARTER</span> /{" "}
              <span className="mono">PAYSTACK_PLAN_PRO</span>) decides what checkout charges.
            </li>
          </ul>
          <p style={{ marginBottom: 0, color: "var(--cp-muted)" }}>
            Editing either is a founder-only action and belongs in the audit log. A database price
            change alone never moves money, and a missing plan code makes subscription checkout
            refuse rather than charge a different amount. Only{" "}
            {COMMERCIAL_PLAN_ORDER.filter((t) => t !== "free").join(" and ")} can be purchased;
            retired tiers keep their historical rows and limits.
          </p>
        </div>
      </Panel>
    </>
  );
}
