import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { pipelineDaily, queueDerived, redisHealth } from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { Badge, KV, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function QueuesPage() {
  await requireSection("infrastructure");
  const [queue, redis, daily] = await Promise.all([
    queueDerived(),
    redisHealth(),
    pipelineDaily(14),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Queues"
        subtitle="One delivery system: everything accepted waits here, workers drain it, failures retry with backoff, exhausted jobs land in dead-letter with their reason."
      />

      <div className="cp-stats">
        <Stat
          label="In flight"
          value={fmtInt(queue.inFlight)}
          hint="created + queued + sending (durable)"
        />
        <Stat
          label="Failures (24h)"
          value={fmtInt(queue.failedRecent)}
          hint="failed or bounced, last 24h"
        />
        <Stat
          label="Oldest waiting"
          value={queue.oldestAgeMinutes === null ? "—" : `${fmtInt(queue.oldestAgeMinutes)}m`}
          hint={
            queue.oldestAgeMinutes !== null && queue.oldestAgeMinutes > 15
              ? "above the 15m comfort line"
              : "healthy"
          }
          invertDelta
        />
        <div className="cp-stat">
          <p className="cp-stat-label">BullMQ counters</p>
          <p
            className="cp-stat-value"
            style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}
          >
            <Dot tone={redis.reachable ? "ok" : "warn"} /> {redis.reachable ? "Live" : "Degraded"}
          </p>
          <p className="cp-stat-foot">
            {redis.reachable ? "Redis reachable" : "falling back to Postgres state"}
          </p>
        </div>
      </div>

      <Panel title="Queue pressure" caption="accepted volume feeding the queue · last 14 days">
        <BarsChart
          data={daily.map((d) => ({ label: d.day, value: d.created }))}
          caption="accepted sends / day"
        />
      </Panel>

      <Panel title="Queue semantics" caption="the retry contract, stated">
        <KV k="Transient failure" v="rethrow → exponential backoff + jitter" mono />
        <KV k="Permanent failure" v="persist failed state, no retry" mono />
        <KV k="Exhausted" v="dead-letter with reason, attempts, last error — replayable" mono />
        <KV k="Suppression" v="checked before every send; blocked, logged, never silent" mono />
        <KV
          k="Live depth source"
          v={
            <Badge tone={redis.reachable ? "ok" : "warn"}>
              {redis.reachable ? "BullMQ via Redis" : "derived from Postgres"}
            </Badge>
          }
        />
      </Panel>

      <p className="cp-caption">
        Worker health and throughput: <Link href="/control/infrastructure/workers">Workers →</Link>
      </p>
    </>
  );
}

function Dot({ tone }: { tone: "ok" | "warn" }) {
  return <span className={`cp-dot ${tone}`} aria-hidden />;
}
