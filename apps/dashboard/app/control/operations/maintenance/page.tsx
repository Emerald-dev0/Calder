import Link from "next/link";
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
        subtitle="Runtime maintenance controls are intentionally not exposed until they are real, permissioned, re-authenticated, and audit-logged. Do not use this page to assume a switch exists."
      />
      <Panel title="Current safe posture" caption="Operator guidance, not fake controls">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
          For incidents, use <Link href="/control/observability/alerts">Alerts</Link>,{" "}
          <Link href="/control/infrastructure">Infrastructure</Link>, and organization sending
          safety controls where authorized. Emergency platform toggles are gated until implemented
          against real queue/API/webhook surfaces.
        </p>
        <KV k="API degradation" v="Not a UI toggle here — use deployment/infra controls." />
        <KV k="Sending pause" v="Not a global UI toggle here — use scoped, audited safety actions." />
        <KV k="Webhooks" v="Independent path; no fake pause control exposed." />
      </Panel>
      <Panel title="Gated controls" caption="Must not render as active switches before implementation">
        <Planned
          state="gated"
          title="Maintenance controls"
          bullets={[
            "Per-surface controls wired to real API/queue/webhook infrastructure",
            "Founder-only execution with recent re-authentication",
            "Emergency message, duration, and rollback path",
            "Mandatory audit record with actor, reason, before, and after",
          ]}
        >
          A maintenance toggle that does not affect real infrastructure is unsafe. This capability
          remains gated until it is implemented and tested end-to-end.
        </Planned>
      </Panel>
    </>
  );
}
