import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";
import { BillingSoon } from "../_components/soon";

export const dynamic = "force-dynamic";

export default async function EntitlementsPage() {
  await requireSection("billing");
  return (
    <>
      <BillingSoon where="This page" />
      <PageHeader
        eyebrow="Billing"
        title="Entitlements"
        subtitle="Plan entitlements are enforced through existing plan/subscription configuration. Custom overrides are not exposed until they are durable and audited."
      />
      <Panel title="Status" caption="Gated capability">
        <Planned
          state="gated"
          title="Entitlement overrides"
          bullets={[
            "Base plan plus explicit per-organization overrides with reason",
            "Audit record for every grant, expiry, and removal",
            "Meter/quota enforcement uses the same authoritative source",
          ]}
        >
          Temporary plan grants can be handled from the organization page with an audit reason.
          Ad hoc entitlement overrides remain gated.
        </Planned>
      </Panel>
    </>
  );
}
