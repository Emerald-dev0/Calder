import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { queueDerived, workerThroughput } from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { PageHeader, Panel, Planned, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function WorkersPage() {
  await requireSection("infrastructure");
  const [throughput, queue] = await Promise.all([workerThroughput(), queueDerived()]);
  const sent24h = throughput.reduce((n, t) => n + t.sent, 0);
  const avgPerHour = throughput.length ? Math.round(sent24h / throughput.length) : 0;

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Workers"
        subtitle="Throughput and queue backlog derived from durable email state. Per-process fleet metrics are gated until emitted and stored."
      />

      <div className="cp-stats">
        <Stat label="Processed (24h)" value={fmtInt(sent24h)} hint="sent + delivered" />
        <Stat label="Throughput" value={`${fmtInt(avgPerHour)}/h`} hint="average per active hour" />
        <Stat label="Waiting" value={fmtInt(queue.inFlight)} hint="queue-derived backlog" />
        <Stat
          label="Failures (24h)"
          value={fmtInt(queue.failedRecent)}
          invertDelta
          hint="inspect in Deliverability/Logs"
        />
      </div>

      <Panel title="Processing rate" caption="Messages moved to sent/delivered per hour (24h)">
        <BarsChart
          data={throughput.map((t) => ({ label: t.hour, value: t.sent }))}
          caption="messages processed / hour"
        />
      </Panel>

      <Panel title="Operational links" caption="Use real signals for incidents">
        <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: 0, lineHeight: 1.6 }}>
          Check <Link href="/control/infrastructure/queues">Queues</Link>,{" "}
          <Link href="/control/platform/deliverability">Deliverability</Link>, and{" "}
          <Link href="/control/observability/alerts">Alerts</Link> for worker/queue symptoms.
        </p>
      </Panel>

      <Panel title="Gated capability" caption="Per-worker process telemetry not stored">
        <Planned
          state="gated"
          title="Worker fleet instrumentation"
          bullets={[
            "Per-worker heartbeat, uptime, and last job",
            "CPU/memory and restart counters",
            "Per-worker processed/failed attribution",
          ]}
        >
          Worker fleet details remain gated until runtime metrics are emitted and queryable.
        </Planned>
      </Panel>
    </>
  );
}
