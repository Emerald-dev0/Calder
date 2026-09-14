import { requireSection } from "@/lib/control/guard";
import { KV, PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function NetworkingPage() {
  await requireSection("infrastructure");
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Networking"
        subtitle="Edge topology, TLS, and the SMTP ingress path — the pipes everything flows through."
      />
      <Panel title="Topology" caption="what exists today">
        <KV k="Marketing site" v="apps/web · Vercel" mono />
        <KV k="Dashboard" v="apps/dashboard · server-rendered" mono />
        <KV k="REST API" v="apps/api · /v1" mono />
        <KV k="SMTP ingress" v="smtp.calder.com:587 · TCP LB pass-through, TLS mandatory" mono />
        <KV k="Anonymous relay" v="impossible by construction — AUTH + TLS required" mono />
      </Panel>
      <Panel title="Planned" caption="edge metrics, LB health, regional view">
        <Planned
          title="Networking observability"
          bullets={[
            "LB connection counts and TLS handshake rates for SMTP",
            "Edge cache hit rates for web/dashboard",
            "Regional routing once regional infrastructure lands (PRD §7)",
          ]}
        >
          The SMTP gateway deploy topology is an open decision (ADR-014); this page activates its monitoring when the
          topology lands.
        </Planned>
      </Panel>
    </>
  );
}
