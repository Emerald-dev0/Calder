import { requireSection } from "@/lib/control/guard";
import { Empty, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireSection("billing");
  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        subtitle="Payment documents issued through the billing provider, mirrored here for support and finance."
      />
      <Panel title="Invoices" caption="provider-issued records" flush>
        <Empty title="No invoices yet">
          Calder&rsquo;s billing runs on local rails via the payment provider abstraction (Bachs first). Invoices
          appear here once the integration issues the first real document — this page will never fabricate one.
        </Empty>
      </Panel>
    </>
  );
}
