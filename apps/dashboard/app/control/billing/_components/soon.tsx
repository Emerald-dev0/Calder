import { Badge } from "@/control/_components/ui";

/**
 * Billing is deliberately not switched on. The catalogue, subscriptions,
 * coupons, credits and invoices screens all read real tables, which makes them
 * look live — and a founder glancing at "MRR ₦0" should not have to remember
 * whether that is a quiet month or a product that cannot take money yet.
 *
 * This banner is rendered by every billing page from one component so the
 * statement cannot drift per screen, and so deleting it is the single visible
 * step that goes with switching payments on.
 */
export function BillingSoon({ where }: { where: string }) {
  return (
    <section className="cp-soon" aria-labelledby="billing-soon-title">
      <div className="cp-soon-head">
        <Badge tone="warn">Coming soon</Badge>
        <h2 className="cp-soon-title" id="billing-soon-title">
          Calder does not take payments yet
        </h2>
      </div>
      <p className="cp-soon-body">
        There is no checkout, no card on file and no charge — so nothing on this page is money
        collected. {where} reads the billing tables directly, and every row here was either seeded
        by hand or written by a founder. Plans stay free until payments open; when they do, this
        banner disappears in the same commit that enables it.
      </p>
    </section>
  );
}
