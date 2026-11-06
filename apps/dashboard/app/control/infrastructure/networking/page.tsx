import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function NetworkingPage() {
  await requireSection("infrastructure");
  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Networking"
        subtitle="Edge/LB/TLS telemetry is not currently stored in Calder. Use infrastructure health and platform observability for current operational signals."
      />
      <Panel title="Current signals" caption="Durable operational views">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Check <Link href="/control/infrastructure">Infrastructure overview</Link>,{" "}
          <Link href="/control/infrastructure/redis">Redis</Link>,{" "}
          <Link href="/control/infrastructure/database">Database</Link>, and{" "}
          <Link href="/control/observability/alerts">Alerts</Link>. Network instrumentation remains
          gated until collected from real infrastructure.
        </p>
      </Panel>
    </>
  );
}
