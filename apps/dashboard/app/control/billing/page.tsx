import Link from "next/link";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { billingOverview, customerTotals } from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { Badge, BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function BillingOverviewPage() {
  await requireSection("billing");
  const [billing, customers] = await Promise.all([billingOverview(), customerTotals()]);

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Overview"
        subtitle="Revenue, subscriptions, and the state of every commercial relationship. NGN-led pricing, live from subscription records."
      />

      <div className="cp-stats">
        <Stat label="MRR" value={fmtMoney(billing.mrrCents)} hint="NGN · active subscriptions" />
        <Stat label="ARR (run-rate)" value={fmtMoney(billing.mrrCents * 12)} hint="MRR × 12" />
        <Stat
          label="Paying customers"
          value={fmtInt(billing.activeCount)}
          hint={
            customers.orgs
              ? `${fmtPct((billing.activeCount / customers.orgs) * 100)} of organizations`
              : undefined
          }
        />
        <Stat
          label="ARPU"
          value={billing.arpuCents !== null ? fmtMoney(billing.arpuCents) : "—"}
          hint="monthly, per paying org"
        />
        <Stat
          label="Past due"
          value={fmtInt(billing.pastDueCount)}
          hint={billing.pastDueCount > 0 ? "needs collection" : "clean"}
        />
        <Stat label="Canceled" value={fmtInt(billing.canceledCount)} hint="historical" />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="New subscriptions per month" caption="when customers commit">
          <BarsChart
            data={billing.newSubsByMonth.map((m) => ({ label: `${m.month}-01`, value: m.count }))}
            caption="new subscriptions / month"
          />
        </Panel>
        <Panel title="Plan mix" caption="active subscriptions by tier">
          <BarList
            items={billing.byPlan.map((p) => ({
              label: `${p.name} · ${fmtMoney(p.monthlyCents)}`,
              count: p.orgs,
              href: `/control/customers/organizations?plan=${p.tier}`,
            }))}
          />
          <p className="cp-panel-caption" style={{ padding: "8px 16px 6px" }}>
            Bars show organization counts; labels show monthly revenue per tier (NGN).
          </p>
        </Panel>
      </div>

      <Panel title="Billing operations" caption="where the commercial levers live">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="cp-btn primary" href="/control/billing/subscriptions">
            Subscriptions
          </Link>
          <Link className="cp-btn" href="/control/billing/plans">
            Plans
          </Link>
          <Link className="cp-btn" href="/control/billing/coupons">
            Coupons
          </Link>
          <Link className="cp-btn" href="/control/billing/credits">
            Credits
          </Link>
          <Link className="cp-btn" href="/control/billing/entitlements">
            Entitlements
          </Link>
          <Link className="cp-btn" href="/control/billing/invoices">
            Invoices
          </Link>
        </div>
        <p className="cp-panel-caption" style={{ marginTop: 12 }}>
          <Badge tone="accent">Founder</Badge> plan catalog changes, coupons, and credits are
          founder-level actions — everything they touch lands in the audit log.
        </p>
      </Panel>
    </>
  );
}
