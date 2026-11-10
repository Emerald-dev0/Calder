import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  await requireSection("communications");
  return (
    <>
      <PageHeader
        eyebrow="Communications"
        title="Campaigns"
        subtitle="Customer marketing campaigns are gated. Internal broadcasts are the only active operator broadcast path and use Calder-managed sending, not connected Gmail."
      />
      <Panel title="Active operator path" caption="Use existing audited surfaces">
        <p
          style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px", lineHeight: 1.6 }}
        >
          Use <Link href="/control/communications">Broadcasts</Link> for internal waitlist/broadcast
          operations and <Link href="/control/communications/delivery">Internal delivery</Link> to
          inspect outcomes. Gmail transports are never a campaign path.
        </p>
      </Panel>
      <Panel title="Gated capability" caption="Campaign engine not enabled">
        <Planned
          state="gated"
          title="Marketing campaign engine"
          bullets={[
            "Audiences, consent, unsubscribe, suppression, and scheduling",
            "Dedicated campaign sending reputation separate from transactional mail",
            "No Gmail transport resolution for campaigns",
            "Per-campaign analytics with real provider events only",
          ]}
        >
          Campaign UI is intentionally gated until the engine, consent model, and sending isolation
          are implemented and verified.
        </Planned>
      </Panel>
    </>
  );
}
