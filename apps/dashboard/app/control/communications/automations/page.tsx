import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireSection("communications");
  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Automations"
        subtitle="Lifecycle automations are gated. No automation engine is exposed until triggers, consent rules, and sending paths are implemented."
      />
      <Panel title="Status" caption="Gated capability">
        <Planned
          state="gated"
          title="Automation engine"
          bullets={[
            "Event-triggered workflows with explicit consent/suppression checks",
            "Transactional and marketing paths kept separate",
            "Auditable execution history per recipient and automation",
          ]}
        >
          Automations remain gated to avoid presenting a non-functional lifecycle system.
        </Planned>
      </Panel>
    </>
  );
}
