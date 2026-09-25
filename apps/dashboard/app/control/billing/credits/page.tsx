import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  await requireSection("billing");
  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Credits"
        subtitle="Compensate customers without touching their subscription: outage gestures, early-adopter thanks, partnership deals."
      />
      <Panel title="Status" caption="specified in PRD §20, built with the credits ledger">
        <Planned
          title="Credits ledger"
          bullets={[
            "Grant: $25 / ₦10,000 with a reason (outage, early adopter, partnership, support gesture)",
            "Consumed by metered sends after plan quota — never negative, never estimated",
            "Fully auditable: purchase → ledger credit → consumption",
            "Distinct from discounts: the subscription stays intact, the balance absorbs usage",
          ]}
        >
          The ledger is a billing-integration primitive — credits without a payments rail to
          reconcile against would be guesswork. The reason codes and audit trail are already
          specified; the ledger lands with Bachs.
        </Planned>
      </Panel>
    </>
  );
}
