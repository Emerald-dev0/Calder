import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import { KV, PageHeader, Panel, Planned, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformApiPage() {
  await requireSection("platform");
  // Request-level metrics need a telemetry store; API key counts are durable.
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
        subtitle="REST surface inventory from durable records. Request latency/error analytics are gated until backed by real telemetry."
      />

      <div className="cp-stats">
        <Stat label="API keys issued" value={String(total)} hint="test + live" />
        <Stat label="Live keys" value={String(live)} hint="production-capable keys" />
        <Stat
          label="Investigations"
          value={<Link href="/control/observability">Logs</Link>}
          hint="event/request traces"
        />
      </div>

      <Panel title="API surface" caption="Current contract">
        <KV k="REST API" v="/v1 · Hono · versioned" mono />
        <KV k="SMTP gateway" v="smtp.calder.com:587 · same pipeline" mono />
        <KV k="Idempotency" v="Idempotency-Key on mutating sends" mono />
        <KV
          k="Rate limiting"
          v="Per IP/key/project/org/endpoint (Redis-backed where configured)"
          mono
        />
        <KV k="Health" v="/health · /ready (dependency-inclusive)" mono />
      </Panel>

      <Panel title="Gated capability" caption="Request analytics require telemetry storage">
        <Planned
          state="gated"
          title="API request analytics"
          bullets={[
            "Requests/min and p50/p95/p99 latency per endpoint",
            "4xx/5xx split with attribution",
            "Authentication failure and rate-limit hit trends",
          ]}
        >
          Structured logs exist; aggregated API metrics are not shown until stored from real
          telemetry.
        </Planned>
      </Panel>
    </>
  );
}
