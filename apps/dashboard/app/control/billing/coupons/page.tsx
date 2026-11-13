import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { paymentLedger } from "@/lib/control/queries";
import { PageHeader, Panel, Planned, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

/**
 * There is no coupon table, no discount column on any price, and no redemption
 * path in checkout. Rather than exposing an empty manager that implies one
 * exists, this page states that plainly and shows the discount-free baseline it
 * would have to reconcile against.
 */
export default async function CouponsPage() {
  await requireSection("billing");
  const ledger = await paymentLedger(1);

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Coupons"
        subtitle="No discount engine exists yet. Checkout charges the listed price exactly, with no promo field."
      />

      <div className="cp-stats">
        <Stat label="Coupons" value="0" hint="no coupon table, no redemption code path" />
        <Stat
          label="Discounted payments"
          value="0"
          hint="every payment row holds the full listed price"
        />
        <Stat
          label="Verified payments"
          value={fmtInt(ledger.totals.paidCents > 0 ? ledger.totals.count : 0)}
          hint="the baseline a discount would have to reconcile against"
        />
      </div>

      <Panel title="Status" caption="gated capability">
        <Planned
          state="gated"
          title="Coupon engine"
          bullets={[
            "A coupon row with an explicit maximum redemption count and expiry",
            "Discount applied at the provider so the charged amount matches the recorded amount",
            "Redemption ledger reconciled against payment rows, with an audit record per change",
            "Founder-only creation; customers never see a coupon field that silently does nothing",
          ]}
        >
          Why this stays closed: the payment path compares the amount taken against the amount
          stored on the payment row and refuses a mismatch. A discount that only exists in the UI
          would therefore fail verification rather than give money away — but it would also fail
          every customer who tried to use it. So the field does not exist yet, and this page will
          not pretend otherwise.
        </Planned>
      </Panel>
    </>
  );
}
