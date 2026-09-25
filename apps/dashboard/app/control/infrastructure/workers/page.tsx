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
        subtitle="The drain on the queue: send execution, retries, webhook delivery, cron. Throughput and failure accounting first; heartbeats land with the observability pipeline."
      />

      <div className="cp-stats">
        <Stat label="Processed (24h)" value={fmtInt(sent24h)} hint="sent + delivered" />
        <Stat label="Throughput" value={`${fmtInt(avgPerHour)}/h`} hint="average per active hour" />
        <Stat label="Waiting" value={fmtInt(queue.inFlight)} hint="queue depth" />
        <Stat
          label="Failures (24h)"
          value={fmtInt(queue.failedRecent)}
          invertDelta
          hint="needs a look if rising"
        />
      </div>

      <Panel title="Processing rate" caption="messages moved to sent/delivered per hour · last 24h">
        <BarsChart
          data={throughput.map((t) => ({ label: t.hour, value: t.sent }))}
          caption="messages processed / hour"
        />
      </Panel>

      <Panel
        title="Planned: fleet instrumentation"
        caption="per-worker CPU, memory, restarts, uptime"
      >
        <Planned
          title="Worker fleet panel"
          bullets={[
            "Per-worker heartbeat with uptime and last job",
            "CPU / memory per worker process",
            "Jobs processed vs failed per worker",
            "Concurrency and restart counters",
          ]}
        >
          Workers are separate deployables (apps/worker) with structured logs already; the fleet
          panel lands with runtime metrics emission.
        </Planned>
      </Panel>
    </>
  );
}
