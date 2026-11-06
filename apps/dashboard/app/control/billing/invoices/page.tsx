import { requireSection } from "@/lib/control/guard";
import { Empty, PageHeader, Panel } from "@/control/_components/ui";
import { BillingSoon } from "../_components/soon";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireSection("billing");
  return (
    <>
      <BillingSoon where="This page" />
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Invoices are not available because live payment collection is not enabled. No placeholder invoice records are shown."
      />
      <Panel title="Invoices" caption="Provider-issued records only" flush>
        <Empty title="No invoice source connected">
          Connect and enable a billing provider before exposing invoice history to operators.
        </Empty>
      </Panel>
    </>
  );
}
