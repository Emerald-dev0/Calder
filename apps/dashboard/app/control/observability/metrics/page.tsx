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
        subtitle="Aggregated series: API latency, send/delivery/bounce/complaint rates, queue depth, worker and provider failures."
      />
      <Panel title="Status" caption="metrics surfaces exist where data is durable today">
        <Planned
          title="Metrics store + panels"
          bullets={[
            "Send, delivery, bounce, complaint rates (already computed live in Platform → Email)",
            "API p50/p95/p99 per endpoint",
            "Queue depth over time (BullMQ counters)",
            "Provider latency percentiles",
          ]}
        >
          Every metric the platform defines in ARCHITECTURE §12 is either already live on a Control
          Plane page or listed here as the remaining aggregation work. Nothing is double-counted and
          nothing is invented.
        </Planned>
      </Panel>
    </>
  );
}
