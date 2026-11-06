import Link from "next/link";
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
        subtitle="Incident records are not yet backed by a durable incident system. Use live alerts and logs for current investigations."
      />
      <Panel title="Current operating surface" caption="Use real signals while incident records are gated">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
          No fabricated incident timeline is shown. Investigate active conditions through{" "}
          <Link href="/control/observability/alerts">Alerts</Link>,{" "}
          <Link href="/control/observability">Logs</Link>,{" "}
          <Link href="/control/infrastructure/queues">Queues</Link>, and{" "}
          <Link href="/control/platform/deliverability">Deliverability</Link>.
        </p>
        <Planned
          state="gated"
          title="Incident records"
          bullets={[
            "Durable incident IDs, severity, status, and attributed timeline entries",
            "Link alerts, operators, mitigations, and post-incident review",
            "Optional status-page publication only after records are real",
          ]}
        >
          Incident command is deferred until records are durable, permissioned, and auditable.
        </Planned>
      </Panel>
    </>
  );
}
