import { getConfig } from "@calder/config";
import { fmtInt } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { gmailCapUsage, transportFleet } from "@/lib/control/queries";
import { Badge, Dot, KV, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  await requireSection("infrastructure");
  const config = getConfig();
  const [fleet, gmail] = await Promise.all([transportFleet(), gmailCapUsage()]);

  const sesConfigured = Boolean(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY);
  const gmailCount = fleet.filter((f) => f.type === "gmail").reduce((n, f) => n + Number(f.value), 0);
  const sesCount = fleet.filter((f) => f.type === "ses").reduce((n, f) => n + Number(f.value), 0);
  const suspended = fleet.filter((f) => f.status !== "active").reduce((n, f) => n + Number(f.value), 0);

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="Providers"
        subtitle="The delivery backbone: provider abstraction → SES adapter (v1) → future adapters. Gmail OAuth transports are customer-connected and capped; nothing here ever logs credentials."
      />

      <div className="cp-stats">
        <div className="cp-stat">
          <p className="cp-stat-label">SES</p>
          <p className="cp-stat-value" style={{ fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>
            <Dot tone={sesConfigured ? "ok" : "warn"} /> {sesConfigured ? "Configured" : "Not configured"}
          </p>
          <p className="cp-stat-foot">
            {sesConfigured ? `region ${config.AWS_REGION}` : "AWS credentials absent — mock provider in dev"}
          </p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Gmail transports</p>
          <p className="cp-stat-value" style={{ fontSize: 17 }}>{fmtInt(gmailCount)}</p>
          <p className="cp-stat-foot">customer OAuth connections · capped daily</p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">SES transports</p>
          <p className="cp-stat-value" style={{ fontSize: 17 }}>{fmtInt(sesCount)}</p>
          <p className="cp-stat-foot">project-configured</p>
        </div>
        <div className="cp-stat">
          <p className="cp-stat-label">Suspended / revoked</p>
          <p className="cp-stat-value" style={{ fontSize: 17 }}>{fmtInt(suspended)}</p>
          <p className="cp-stat-foot">{suspended > 0 ? "failing closed — inspect" : "all active"}</p>
        </div>
      </div>

      <Panel title="Gmail cap usage" caption="sends today vs daily cap — enforced pre-send, over-cap fails permanently and explainably">
        {gmail.length === 0 ? (
          <p className="cp-panel-caption" style={{ padding: "4px 0" }}>
            No Gmail transports connected.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Transport</th>
                  <th>Status</th>
                  <th>Sent today</th>
                  <th>Daily cap</th>
                  <th>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {gmail.map((g) => {
                  const cap = g.dailyCap ?? 400;
                  const pct = Math.min(100, (g.sentToday / cap) * 100);
                  return (
                    <tr key={g.label}>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {g.label}
                      </td>
                      <td>
                        <Badge tone={g.status === "active" ? "ok" : "warn"}>{g.status}</Badge>
                      </td>
                      <td className="cp-num">{fmtInt(g.sentToday)}</td>
                      <td className="cp-num">{fmtInt(cap)}</td>
                      <td>
                        <div className="cp-bartrack" style={{ width: 140 }}>
                          <div className={`cp-barfill${pct > 80 ? "" : " ok"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Routing" caption="transport resolution at send time">
        <KV k="Resolution" v="job → project_transports → pickDefaultTransport()" mono />
        <KV k="Graduation" v="gmail → verified domain (SES) → managed infra: a row update, not a reintegration" mono />
        <KV k="Credentials" v="AES-256-GCM at rest, decrypted in-memory at send, never logged" mono />
        <KV
          k="Failover"
          v={<Badge>multi-provider failover: Later (PRD §7)</Badge>}
        />
      </Panel>
    </>
  );
}
