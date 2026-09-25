import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function StatusPagePage() {
  await requireSection("operations");
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Status Page"
        subtitle="Trust through transparency (DESIGN §0): the public surface where incidents live in the open."
      />
      <Panel
        title="Status"
        caption="the public page exists; incident publication is one click away"
      >
        <Planned
          title="Status publishing"
          bullets={[
            "Publish an incident from Observability → Incidents with one click",
            "Component-level state: API, dashboard, sending, SMTP, webhooks",
            "History and uptime banners, matching the marketing status page",
          ]}
        >
          The marketing status page (apps/web/status) already exists as a surface; wiring it to live
          incident records completes the loop.
        </Planned>
      </Panel>
    </>
  );
}
