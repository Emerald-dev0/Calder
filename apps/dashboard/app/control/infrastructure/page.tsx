import Link from "next/link";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import {
  dbHealth,
  queueDerived,
  redisHealth,
  transportFleet,
  workerThroughput,
} from "@/lib/control/queries";
import { BarsChart } from "@/control/_components/charts";
import { Badge, Dot, KV, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function InfrastructureOverview() {
  await requireSection("infrastructure");
  const [db, redis, queue, fleet, throughput] = await Promise.all([
    dbHealth(),
    redisHealth(),
    queueDerived(),
    transportFleet(),
    workerThroughput(),
  ]);

  const fleetLine = fleet.map((f) => `${f.type}:${f.status}×${Number(f.value)}`).join("  ");

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Overview"
        subtitle="Every dependency the pipeline stands on, probed live on page load. A degraded dependency is stated plainly — never hidden behind a green dot."
      />

      <div className="cp-stats">
        <div className="cp-stat">
          <p className="cp-stat-label">Postgres</p>
          <p
            className="cp-stat-value"
            style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}
          >
            <Dot tone={db.reachable ? "ok" : "bad"} /> {db.reachable ? "Operational" : "Down"}
          </p>
          <p className="cp-stat-foot">
            {db.latencyMs !== null ? `${db.latencyMs}ms query latency` : "no response"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Redis</p>
          <p
            className="cp-stat-value"
            style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}
          >
            <Dot tone={redis.reachable ? "ok" : "warn"} />{" "}
            {redis.reachable ? "Operational" : "Unreachable"}
          </p>
          <p className="cp-stat-foot">
            {redis.reachable
              ? `${fmtInt(redis.opsPerSec ?? 0)} ops/s · v${redis.version}`
              : "queue + cache + rate limits degrade"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Queue</p>
          <p
            className="cp-stat-value"
            style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}
          >
            <Dot
              tone={queue.inFlight > 5000 || (queue.oldestAgeMinutes ?? 0) > 15 ? "warn" : "ok"}
            />{" "}
            {queue.inFlight > 0 ? `${fmtInt(queue.inFlight)} in flight` : "Empty"}
          </p>
          <p className="cp-stat-foot">
            {queue.oldestAgeMinutes !== null
              ? `oldest ${queue.oldestAgeMinutes}m`
              : "nothing waiting"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Transports</p>
          <p className="cp-stat-value" style={{ fontSize: 17 }}>
            {fleet.reduce((n, f) => n + Number(f.value), 0)}
          </p>
          <p className="cp-stat-foot mono" style={{ fontSize: 11 }}>
            {fleetLine || "none configured"}
          </p>
        </div>
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Worker throughput" caption="messages moved to sent/delivered · last 24h">
          <BarsChart
            data={throughput.map((t) => ({ label: t.hour, value: t.sent }))}
            caption="messages processed / hour"
          />
        </Panel>
        <Panel title="Jump to systems" caption="per-dependency deep views">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="cp-btn" href="/control/infrastructure/redis">
              Redis
            </Link>
            <Link className="cp-btn" href="/control/infrastructure/queues">
              Queues
            </Link>
            <Link className="cp-btn" href="/control/infrastructure/workers">
              Workers
            </Link>
            <Link className="cp-btn" href="/control/infrastructure/database">
              Database
            </Link>
            <Link className="cp-btn" href="/control/infrastructure/providers">
              Providers
            </Link>
          </div>
          <p className="cp-panel-caption" style={{ marginTop: 12 }}>
            Storage, cron, and networking views are scaffolded with their planned instruments.
          </p>
        </Panel>
      </div>

      <Panel title="Dependency state" caption="live probe results">
        <KV k="Postgres version" v={db.reachable ? db.version : "unreachable"} mono />
        <KV
          k="Postgres size"
          v={db.sizeBytes !== null ? `${(db.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"}
          mono
        />
        <KV
          k="Redis memory"
          v={
            redis.reachable && redis.usedMemoryBytes !== null
              ? `${(redis.usedMemoryBytes / 1024 / 1024).toFixed(1)} MB${redis.maxMemoryBytes ? ` / ${(redis.maxMemoryBytes / 1024 / 1024).toFixed(0)} MB` : ""}`
              : "—"
          }
          mono
        />
        <KV k="Queue failures (24h)" v={fmtInt(queue.failedRecent)} mono />
        <KV
          k="Overall"
          v={
            <Badge
              tone={
                db.reachable && queue.oldestAgeMinutes !== null && queue.oldestAgeMinutes <= 15
                  ? "ok"
                  : "warn"
              }
            >
              {db.reachable ? "operational" : "degraded"}
            </Badge>
          }
        />
      </Panel>
    </>
  );
}
