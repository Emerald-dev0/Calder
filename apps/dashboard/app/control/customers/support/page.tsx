import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  await requireSection("customers");
  return (
    <>
      <PageHeader
        eyebrow="Customers"
        title="Support"
        subtitle="Every customer conversation, ticket, and resolution — connected to the account it belongs to."
      />
      <Panel title="Status" caption="the 360° view exists; the ticketing layer is next">
        <Planned
          title="Support workspace"
          bullets={[
            "Ticket timeline per user / organization, linked from their profile",
            "Operator notes (already live on waitlist profiles) extended to accounts",
            "Courtesy credits and resend actions, each audit-logged",
            "Read-only view-as-customer sessions with explicit banners",
          ]}
        >
          Today, support context lives where the data is: the user and organization pages carry memberships, usage,
          billing state, and audit trails. The ticketing layer lands with the first non-founder support admin.{" "}
          <Link href="/control/customers">Open the customer directory →</Link>
        </Planned>
      </Panel>
    </>
  );
}
