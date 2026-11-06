import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";
import { BillingSoon } from "../_components/soon";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  await requireSection("billing");
  return (
    <>
      <BillingSoon where="This page" />
      <PageHeader
        eyebrow="Billing"
        title="Credits"
        subtitle="Customer credits are not enabled. No manual credit ledger is exposed until it is auditable, provider-reconciled, and metering-aware."
      />
      <Panel title="Status" caption="Gated capability">
        <Planned
          state="gated"
          title="Credits ledger"
          bullets={[
            "Auditable grant/consume records with reason, actor, and balance",
            "Metering and provider reconciliation before any balance affects billing",
            "No negative balances or estimated consumption",
          ]}
        >
          Credits remain gated to avoid support gestures being mistaken for production billing state.
        </Planned>
      </Panel>
    </>
  );
}
