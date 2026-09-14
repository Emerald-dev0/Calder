import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { dbHealth } from "@/lib/control/queries";
import { Badge, KV, PageHeader, Panel, Stat } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function DatabasePage() {
  await requireSection("infrastructure");
  const db = await dbHealth();

  if (!db.reachable) {
    return (
      <>
        <PageHeader eyebrow="Infrastructure" title="Database" subtitle="Postgres is the single source of truth." />
        <Panel title="Unreachable" caption="the probe failed — this is a live incident">
          <Badge tone="bad">No response from Postgres</Badge>
        </Panel>
      </>
    );
  }

  const connPct = db.connections !== null && db.maxConnections ? (db.connections / db.maxConnections) * 100 : null;

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Database"
        subtitle="Postgres: users, organizations, projects, emails, events, billing state. Probed live — size, connections, cache, and the heaviest tables."
      />

      <div className="cp-stats">
        <Stat label="Status" value="Operational" hint={db.version} />
        <Stat label="Query latency" value={db.latencyMs !== null ? `${db.latencyMs}ms` : "—"} hint="probe round-trip" />
        <Stat
          label="Connections"
          value={db.connections !== null && db.maxConnections ? `${db.connections} / ${db.maxConnections}` : "—"}
          hint={connPct !== null ? `${connPct.toFixed(0)}% of max` : undefined}
        />
        <Stat
          label="Cache hit rate"
          value={db.cacheHitRate === null ? "—" : `${db.cacheHitRate.toFixed(1)}%`}
          hint="shared buffer effectiveness"
        />
      </div>

      <div className="cp-grid cp-grid-2">
        <Panel title="Server" caption="live catalog probes">
          <KV k="Version" v={db.version} mono />
          <KV k="Database size" v={db.sizeBytes !== null ? `${(db.sizeBytes / 1024 / 1024).toFixed(1)} MB` : "—"} mono />
          <KV k="Uptime since" v={db.uptimeSince ? db.uptimeSince.toISOString().slice(0, 16).replace("T", " ") : "—"} mono />
          <KV
            k="Connections"
            v={db.connections !== null && db.maxConnections ? `${db.connections} / ${db.maxConnections}` : "—"}
            mono
          />
        </Panel>
        <Panel title="Heaviest tables" caption="by total relation size" flush>
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Est. rows</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {db.tables.map((t) => (
                  <tr key={t.table}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {t.table}
                    </td>
                    <td className="cp-num">{fmtInt(t.rows)}</td>
                    <td className="cp-num">{(t.sizeBytes / 1024 / 1024).toFixed(1)} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <p className="cp-caption">
        Backups, replication, and slow-query capture are managed-Postgres concerns and land with the production
        provider choice. This page probes the live system, never a cached snapshot.
      </p>
    </>
  );
}
