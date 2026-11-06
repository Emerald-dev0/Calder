import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  await requireSection("observability");
  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Metrics"
        subtitle="A dedicated metrics store is not wired. Existing pages already expose durable delivery, queue, health, and usage signals from live data."
      />
      <Panel title="Use live metrics surfaces" caption="Current authoritative views">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          <Link href="/control/platform">Email/Platform</Link>,{" "}
          <Link href="/control/platform/deliverability">Deliverability</Link>,{" "}
          <Link href="/control/infrastructure/queues">Queues</Link>,{" "}
          <Link href="/control/infrastructure">Infrastructure</Link>, and{" "}
          <Link href="/control/platform/usage">Usage</Link> show real stored/derived values.
        </p>
      </Panel>
      <Panel title="Gated capability" caption="Requires metrics aggregation backend">
        <Planned
          state="gated"
          title="Metrics aggregation"
          bullets={[
            "API latency percentiles and endpoint error rates",
            "Provider latency and failure series",
            "Time-series retention and alert integration",
          ]}
        >
          Aggregated request/provider metrics remain gated until backed by real telemetry storage.
        </Planned>
      </Panel>
    </>
  );
}
