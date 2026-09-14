import { fmtInt, fmtPct } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { redisHealth } from "@/lib/control/queries";
import { Badge, KV, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

function mb(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function RedisPage() {
  await requireSection("infrastructure");
  const redis = await redisHealth();

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Redis"
        subtitle="Queue backend, rate-limit counters, idempotency locks, and config cache. Every entry has a TTL and an invalidation strategy — never a second source of truth."
      />

      {redis.reachable ? (
        <>
          <div className="cp-stats">
            <Stat label="Status" value="Operational" hint={`v${redis.version} · up ${fmtInt(redis.uptimeDays ?? 0)}d`} />
            <Stat label="Memory used" value={mb(redis.usedMemoryBytes)} hint={redis.maxMemoryBytes ? `max ${mb(redis.maxMemoryBytes)}` : "no maxmemory set"} />
            <Stat
              label="Cache hit rate"
              value={redis.hitRate === null ? "—" : fmtPct(redis.hitRate)}
              hint="keyspace hits / (hits + misses)"
            />
            <Stat label="Ops/sec" value={fmtInt(redis.opsPerSec ?? 0)} hint={`${fmtInt(redis.connectedClients ?? 0)} clients`} />
          </div>
          <Panel title="Server detail" caption="live INFO snapshot">
            <KV k="Version" v={redis.version ?? "—"} mono />
            <KV k="Uptime" v={`${fmtInt(redis.uptimeDays ?? 0)} days`} mono />
            <KV k="Used memory" v={mb(redis.usedMemoryBytes)} mono />
            <KV k="Max memory" v={mb(redis.maxMemoryBytes)} mono />
            <KV k="Connected clients" v={fmtInt(redis.connectedClients ?? 0)} mono />
            <KV k="Instantaneous ops/sec" v={fmtInt(redis.opsPerSec ?? 0)} mono />
            <KV k="Evicted keys" v={fmtInt(redis.evictedKeys ?? 0)} hint={redis.evictedKeys ? "memory pressure signal" : undefined} mono />
            <KV k="Hit rate" v={redis.hitRate === null ? "—" : fmtPct(redis.hitRate)} mono />
          </Panel>
        </>
      ) : (
        <Panel title="Redis unreachable" caption="PING failed — degraded but not fatal">
          <p style={{ fontSize: 13.5, color: "var(--cp-muted)", margin: "0 0 10px" }}>
            Delivery falls back to the durable Postgres pipeline state; retries, rate limiting, and caching degrade
            to conservative defaults. This state is alertable — see Observability → Alerts.
          </p>
          <Badge tone="warn">REDIS_URL: {process.env.REDIS_URL ? "configured" : "unset"}</Badge>
        </Panel>
      )}
    </>
  );
}
