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
        subtitle="Event → condition → delay → email. Lifecycle sequences that run without an operator pressing send."
      />
      <Panel
        title="Status"
        caption="specified in the PRD, priced separately, deliberately post-MVP"
      >
        <Planned
          title="Automation engine"
          bullets={[
            "Triggers: waitlist joined, account created, first send, plan upgraded",
            "Conditions: plan, source, activity window, tags",
            "Delays and exits, with the same consent + suppression rules as campaigns",
            "Transactional automations (OTP flows) stay in the transactional path, not here",
          ]}
        >
          Automations are a marketing-surface feature for customers and an internal lifecycle tool
          for the team. They ship after the campaign engine proves audiences, consent, and
          scheduling — never before the foundations they stand on.
        </Planned>
      </Panel>
    </>
  );
}
