import { Badge } from "@/control/_components/ui";

/**
 * Billing operations read real tables, but Calder does not accept payments in
 * production until billing is explicitly enabled. This banner prevents "₦0 /
 * seeded rows" from being mistaken for live revenue collection.
 */
export function BillingSoon({ where }: { where: string }) {
  return (
    <section className="cp-soon" aria-labelledby="billing-soon-title">
      <div className="cp-soon-head">
        <Badge tone="warn">Payments not enabled</Badge>
        <h2 className="cp-soon-title" id="billing-soon-title">
          Billing data is operational, not revenue collection
        </h2>
      </div>
      <p className="cp-soon-body">
        {where} reads live billing tables for operator visibility. No checkout, card capture, or
        charge flow is active unless billing is explicitly enabled. Do not treat amounts here as
        collected revenue; verify subscription/payment state before taking customer-facing action.
      </p>
    </section>
  );
}
