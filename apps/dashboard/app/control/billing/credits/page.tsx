import Link from "next/link";
import {
  CREDIT_EXPIRY_MONTHS,
  CREDIT_PACKS,
  DAILY_BURST_PASS,
  formatUsdCents,
} from "@calder/config";
import { fmtDate, fmtInt, fmtMoney } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { creditLedger } from "@/lib/control/queries";
import { BarList, Empty, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * Prepaid credits are a live, provider-backed ledger — not a planned feature.
 * A purchase row exists only after a payment the API verified with Paystack for
 * the exact amount and currency, and every grant, consume, release and expiry
 * is a signed transaction. Nothing on this page writes: balances are moved by
 * verified payments and by the send path, never by hand.
 */
export default async function CreditsPage() {
  await requireSection("billing");
  const ledger = await creditLedger(50);

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Credits"
        subtitle={`Prepaid email credits and Daily Burst Passes. Unused credits expire ${CREDIT_EXPIRY_MONTHS} months after purchase; a pass adds daily capacity only, for one UTC day.`}
      />

      <div className="cp-stats">
        <Stat
          label="Credits purchased"
          value={fmtInt(ledger.purchases.granted)}
          hint={`${fmtInt(ledger.purchases.count)} packs · ${fmtMoney(ledger.purchases.cents, "USD")} verified`}
        />
        <Stat
          label="Still available"
          value={fmtInt(ledger.purchases.remaining)}
          hint="sum of remaining credits across all packs, expired or not"
        />
        <Stat
          label="Consumed"
          value={fmtInt(ledger.transactions.consumed)}
          hint="credits spent covering overage above the monthly allowance"
        />
        <Stat
          label="Expired"
          value={fmtInt(ledger.transactions.expired)}
          hint={`${fmtInt(ledger.transactions.released)} released on failed sends`}
        />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Where credits are held" caption="top 10 organizations by unexpired balance">
          <BarList
            items={ledger.byOrg.map((r) => ({
              label: r.name,
              count: r.remaining,
              href: `/control/customers/organizations/${r.organizationId}`,
            }))}
          />
        </Panel>
        <Panel title="Products" caption="configuration, not database rows">
          {CREDIT_PACKS.map((pack) => (
            <div className="cp-kv" key={pack.id}>
              <span className="k">
                {pack.name} · {fmtInt(pack.credits)} credits
              </span>
              <span className="v mono">{formatUsdCents(pack.amountCents)}</span>
            </div>
          ))}
          <div className="cp-kv">
            <span className="k">
              {DAILY_BURST_PASS.name} · +{fmtInt(DAILY_BURST_PASS.additionalCapacity)} today, max{" "}
              {DAILY_BURST_PASS.maxPerUtcDay}/UTC day
            </span>
            <span className="v mono">{formatUsdCents(DAILY_BURST_PASS.amountCents)}</span>
          </div>
          <p className="cp-panel-caption" style={{ marginTop: 12 }}>
            Credits cover only overage above a plan&rsquo;s included monthly allowance. There is no
            automatic top-up and no overage billing: a credit is granted only after a verified
            payment.
          </p>
        </Panel>
      </div>

      <Panel
        title="Recent credit purchases"
        caption={`newest ${Math.min(50, ledger.recentPurchases.length)} · one row per verified payment`}
        flush
      >
        {ledger.recentPurchases.length === 0 ? (
          <Empty title="No credit purchases yet">
            Nothing has been bought. A row appears here only after the provider confirms a payment
            for the exact pack price.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Pack</th>
                  <th>Payment reference</th>
                  <th>Purchased</th>
                  <th>Expires</th>
                  <th className="cp-num">Remaining</th>
                  <th className="cp-num">Paid</th>
                </tr>
              </thead>
              <tbody>
                {ledger.recentPurchases.map((r) => (
                  <tr key={r.purchase.id}>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        {r.organization.name}
                      </Link>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {r.purchase.packId}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.purchase.paymentReference}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtDate(new Date(r.purchase.purchasedAt))}
                    </td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtDate(new Date(r.purchase.expiresAt))}
                    </td>
                    <td className="cp-num">
                      {fmtInt(r.purchase.creditsRemaining)} / {fmtInt(r.purchase.creditsPurchased)}
                    </td>
                    <td className="cp-num">
                      {fmtMoney(
                        r.purchase.amountCents,
                        r.purchase.currency === "USD" ? "USD" : "NGN"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Recent credit transactions" caption="signed movements, newest 50" flush>
        {ledger.recentTransactions.length === 0 ? (
          <Empty title="No credit movements yet">
            Grants, consumption, releases and expiries all appear here as signed amounts.
          </Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th>When</th>
                  <th className="cp-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.recentTransactions.map((r) => (
                  <tr key={r.transaction.id}>
                    <td>
                      <Link href={`/control/customers/organizations/${r.organization.id}`}>
                        {r.organization.name}
                      </Link>
                    </td>
                    <td>{r.transaction.type}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {r.transaction.referenceId ?? "—"}
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>{r.transaction.description ?? "—"}</td>
                    <td className="mono" style={{ fontSize: 12.5, color: "var(--cp-muted)" }}>
                      {fmtDate(new Date(r.transaction.createdAt))}
                    </td>
                    <td className="cp-num">
                      {r.transaction.amount > 0 ? "+" : ""}
                      {fmtInt(r.transaction.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
