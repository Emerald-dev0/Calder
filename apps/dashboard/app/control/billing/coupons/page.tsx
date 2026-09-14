import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CouponsPage() {
  await requireSection("billing");
  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Coupons"
        subtitle="Launch discounts, partner codes, and free periods — created, tracked, and audited."
      />
      <Panel title="Status" caption="designed; lands with the billing provider integration">
        <Planned
          title="Coupon engine"
          bullets={[
            "Percentage off (LAUNCH50: 50% off Pro, 3 months, 500 redemptions)",
            "100% free periods (EARLYCALDER: Pro, 90 days)",
            "Fixed amount off (₦5,000 off)",
            "Per-coupon tracking: redemptions, conversions, revenue generated",
            "Founder-only creation, every application audit-logged",
          ]}
        >
          Coupons need a billing provider to discount against — the schema lands with the Bachs integration so codes
          are real from day one rather than promises in a table. Until then, custom deals are expressed through plan
          grants (temporary upgrades with an explicit return date).
        </Planned>
      </Panel>
    </>
  );
}
