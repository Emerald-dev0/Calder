import Link from "next/link";
import { fmtDate, fmtInt, fmtMoney, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { billingOverview, customerTotals, paymentLedger } from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { Badge, BarList, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function BillingOverviewPage() {
  await requireSection("billing");
  const [billing, customers, ledger] = await Promise.all([
    billingOverview(),
    customerTotals(),
    paymentLedger(20),
  ]);
  const currencies = ledger.byCurrency.map((c) => c.currency).sort();

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Overview"
        subtitle="Subscriptions, list-price MRR, and provider-verified payments — read straight from the billing tables."
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

      <div className="cp-stats">
        <Stat
          label="Collected (verified)"
          value={
            currencies.length === 0
              ? "—"
              : currencies
                  .map((c) =>
                    fmtMoney(
                      ledger.byCurrency.find((x) => x.currency === c)?.cents ?? 0,
                      c === "USD" ? "USD" : "NGN"
                    )
                  )
                  .join(" + ")
          }
          hint={`${fmtInt(ledger.totals.count)} payment rows · only rows the API verified with the provider`}
        />
        <Stat
          label="Collected (30d)"
          value={fmtMoney(ledger.last30.cents, "USD")}
          hint={`${fmtInt(ledger.last30.count)} verified payments`}
        />
        <Stat
          label="Pending / failed"
          value={`${fmtInt(ledger.totals.pending)} / ${fmtInt(ledger.totals.failed)}`}
          hint={
            ledger.totals.pending + ledger.totals.failed + ledger.totals.abandoned === 0
              ? "nothing stuck"
              : "checkout attempts that never became money"
          }
        />
        <Stat
          label="Refunded"
          value={fmtInt(ledger.totals.refunded)}
          hint="provider-issued refunds recorded on the payment row"
        />
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
            Bars show organization counts; labels show list-price revenue per tier (NGN plan
            prices). Checkout charges in USD, so this is catalogue value, not collected cash — the
            collected figure comes from verified payment rows above.
          </p>
        </Panel>
      </div>

      <Panel title="Latest payments" caption="newest 20 · every row is a provider-verified record">
        {ledger.rows.length === 0 ? (
          <div className="cp-empty">
            <b>No payment rows yet</b>
            Checkout writes a pending row before it asks the provider, so this list stays empty
            until a checkout is started — and nothing here is ever inferred from a browser redirect.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Organization</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="cp-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((r) => (
                  <tr key={r.payment.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.payment.reference}
                    </td>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        {r.organization.name}
                      </Link>
                    </td>
                    <td>{r.payment.kind.replace("_", " ")}</td>
                    <td>
                      <Badge
                        tone={
                          r.payment.status === "success"
                            ? "ok"
                            : r.payment.status === "pending"
                              ? "warn"
                              : r.payment.status === "failed"
                                ? "bad"
                                : undefined
                        }
                      >
                        {r.payment.status}
                      </Badge>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtDate(new Date(r.payment.createdAt))}
                    </td>
                    <td className="cp-num">
                      {fmtMoney(
                        r.payment.amountCents,
                        r.payment.currency === "USD" ? "USD" : "NGN"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
          <Badge tone="accent">Founder</Badge> plan catalogue changes are founder-level actions and
          land in the audit log. Credits and payments are read-only here: they are written only by a
          verified provider payment, never by hand.
        </p>
      </Panel>
    </>
  );
}
