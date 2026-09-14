import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  await requireSection("observability");
  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Incidents"
        subtitle="Alert that pages a human → investigation → mitigation → resolution, with a timeline you can publish."
      />
      <Panel title="Status" caption="no incident system yet — alerts are the current surface">
        <Planned
          title="Incident command"
          bullets={[
            "INC-XXXX records with severity (SEV-1..4) and status (investigating → identified → monitoring → resolved)",
            "Timeline: alert triggered → investigation → mitigation → resolved, every entry attributed",
            "One-click publish to the public status page",
            "Post-incident review attached to the record",
          ]}
        >
          The escalation path today: an alert fires on the Command Center, you investigate through the linked surface,
          and the fix lands. Formal incident records begin when there is more than one operator to coordinate.
        </Planned>
      </Panel>
    </>
  );
}
