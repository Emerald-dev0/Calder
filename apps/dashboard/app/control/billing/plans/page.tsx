import { asc, eq } from "drizzle-orm";
import { plans, planPrices, subscriptions } from "@calder/db";
import { getDb } from "@calder/db";
import { fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  await requireSection("billing");
  const db = getDb();
  const [planRows, priceRows, activeSubs] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.createdAt)),
    db.select().from(planPrices),
    db.select({ planId: subscriptions.planId }).from(subscriptions).where(eq(subscriptions.status, "active")),
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
                  <span className="k">{pr.currency} / {pr.interval}</span>
                  <span className="v mono">{fmtMoney(pr.amountCents, pr.currency as "NGN" | "USD")}</span>
                </div>
              ))}
              <div className="cp-kv">
                <span className="k">Active subscriptions</span>
                <span className="v mono">{fmtInt(activeByPlan.get(p.id) ?? 0)}</span>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel title="Plan controls" caption="founder-level, deliberate about when">
        <div className="cp-planned">
          <b>Plan editing &amp; entitlements configuration</b>
          <p>
            Editing prices, quotas, and limits is a founder-only action and lands with the billing integration (Bachs)
            — a price change without a billing provider to reconcile against is a half-action. The catalog above is the
            live source of truth; plan assignment already works from any organization page.
          </p>
        </div>
      </Panel>
    </>
  );
}
