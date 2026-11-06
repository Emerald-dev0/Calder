import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";
import { BillingSoon } from "../_components/soon";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  await requireSection("billing");
  return (
    <>
      <BillingSoon where="This page" />
      <PageHeader
        eyebrow="Billing"
        title="Coupons"
        subtitle="Coupon and discount operations are not enabled until the billing provider integration is production-ready and audited."
      />
      <Panel title="Status" caption="Gated capability">
        <Planned
          state="gated"
          title="Coupon engine"
          bullets={[
            "Provider-backed coupon creation, redemption, and reconciliation",
            "Founder-only controls with audit records for every change",
            "Clear separation between list price, discount, and collected amount",
          ]}
        >
          This page is intentionally not an active coupon manager. Exposing a fake coupon workflow
          would create billing and support risk.
        </Planned>
      </Panel>
    </>
  );
}
