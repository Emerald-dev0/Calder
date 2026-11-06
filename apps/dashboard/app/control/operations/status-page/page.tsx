import Link from "next/link";
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
        subtitle="Public status publication is gated. Do not publish incidents from a non-durable incident source."
      />
      <Panel title="Current surfaces" caption="Use live operational data">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Monitor real platform state in <Link href="/control">Command Center</Link>,{" "}
          <Link href="/control/observability/alerts">Alerts</Link>, and{" "}
          <Link href="/control/infrastructure">Infrastructure</Link>.
        </p>
      </Panel>
      <Panel title="Gated capability" caption="Publication requires durable incidents">
        <Planned
          state="gated"
          title="Status publishing"
          bullets={[
            "Publish from durable incident records, not ad hoc UI state",
            "Component-level status with attributed updates",
            "Audit every public status change",
          ]}
        >
          Status publishing remains gated until incident records and publication workflow are real.
        </Planned>
      </Panel>
    </>
  );
}
