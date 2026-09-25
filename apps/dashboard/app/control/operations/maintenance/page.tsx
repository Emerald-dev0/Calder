import { requireSection } from "@/lib/control/guard";
import { KV, PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  await requireSection("operations");
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Maintenance"
        subtitle="Platform-wide controls for the worst day: what can be turned off, in what order, and how customers find out."
      />
      <Panel title="Emergency control plan" caption="the designed switches">
        <KV k="API" v="rate-limit to a crawl or 503 with a clear body — never a silent drop" />
        <KV
          k="Sending"
          v="pause queue drain; accepts continue, delivery halts, everything stays durable"
        />
        <KV k="Webhooks" v="independent of sending; can keep flowing during delivery incidents" />
        <KV
          k="Dashboard"
          v="read-only banner before shutdown; customers never learn state from a 500"
        />
      </Panel>
      <Panel title="Status" caption="founder-only switches, wired to real infrastructure">
        <Planned
          title="Maintenance controls"
          bullets={[
            "Per-surface toggles with an emergency message",
            "Global rate limits (anonymous / authenticated / API / admin)",
            "Emergency sending pause with automatic queue resume",
            "Every flip requires recent re-authentication and lands in the audit log",
          ]}
        >
          These switches must be real before they are rendered — a maintenance toggle that doesn't
          touch the queue is a dangerous fiction. They land with the production infrastructure
          setup.
        </Planned>
      </Panel>
    </>
  );
}
