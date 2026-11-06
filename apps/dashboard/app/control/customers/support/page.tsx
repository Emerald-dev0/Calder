import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  await requireSection("customers");
  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Support"
        subtitle="Use customer and organization records for investigations. A dedicated ticketing workspace is not implemented."
      />
      <Panel title="Current support workflow" caption="Durable records, no fake ticket system">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Investigate via <Link href="/control/customers">Users</Link>,{" "}
          <Link href="/control/customers/organizations">Organizations</Link>,{" "}
          <Link href="/control/observability">Logs</Link>, and{" "}
          <Link href="/control/platform/deliverability">Deliverability</Link>. Administrative
          actions must remain permissioned and audit-logged.
        </p>
      </Panel>
    </>
  );
}
