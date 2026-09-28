import { sql } from "drizzle-orm";
import { getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { KV, PageHeader, Panel, Planned, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformApiPage() {
  await requireSection("platform");
  // Request-level metrics need the observability pipeline; today the honest
  // signals are the key count and the API's own health endpoint shape.
  const db = getDb();
  const keyRows = await db.execute<{ total: string; live: string }>(sql`
    select count(*)::text as total, count(*) filter (where env = 'live')::text as live from api_keys
  `);
  const total = Number(keyRows[0]?.total ?? 0);
  const live = Number(keyRows[0]?.live ?? 0);

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="API"
        subtitle="The public REST surface: keys, traffic, and errors. Metrics arrive with the observability pipeline — this page never invents them."
      />

      <div className="cp-stats">
        <Stat label="API keys issued" value={String(total)} hint="test + live" />
        <Stat label="Live keys" value={String(live)} hint="production traffic capable" />
        <Stat
          label="Error shape"
          value="{code, message, request_id}"
          hint="predictable, versioned /v1"
        />
      </div>

      <Panel title="API surface" caption="what exists today">
        <KV k="REST API" v="/v1 · Hono · versioned from first release" mono />
        <KV k="SMTP gateway" v="smtp.calder.com:587 · same pipeline" mono />
        <KV k="Idempotency" v="Idempotency-Key on mutating sends" mono />
        <KV k="Rate limiting" v="per IP / key / project / org / endpoint (Redis-backed)" mono />
        <KV k="Health" v="/health · /ready (dependency-inclusive)" mono />
      </Panel>

      <Panel
        title="Planned: request metrics"
        caption="latency, 4xx/5xx rates, auth failures, throughput"
      >
        <Planned
          title="API observability"
          bullets={[
            "Requests/min and p50/p95/p99 latency per endpoint",
            "4xx vs 5xx split with top offenders",
            "Authentication failure spikes (compromised-key signal)",
            "Rate-limit hit rates per dimension",
          ]}
        >
          Structured JSON logs with request_id tracing already exist in the API; the aggregation
          surface (metrics store + these panels) is the remaining piece, tracked in the roadmap.
        </Planned>
      </Panel>
    </>
  );
}
