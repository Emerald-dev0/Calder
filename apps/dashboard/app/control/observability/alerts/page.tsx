import Link from "next/link";
import { requireSection } from "@/lib/control/guard";
import { evaluateAlerts } from "@/lib/control/queries";
import { Dot, PageHeader, Panel } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

const RULES: Array<{ name: string; threshold: string; note: string }> = [
  { name: "Delivery rate (24h)", threshold: "< 97%", note: "below target, page if < 95%" },
  { name: "Complaints (24h)", threshold: "> 0", note: "any complaint is investigated" },
  { name: "Bounce rate (24h)", threshold: "> 3%", note: "list quality or reputation signal" },
  { name: "Queue depth", threshold: "> 5,000", note: "in-flight messages" },
  { name: "Oldest queued message", threshold: "> 15 min", note: "worker stall signal" },
  { name: "Redis reachability", threshold: "PING fails", note: "degraded retries + rate caps" },
  { name: "Redis memory", threshold: "> 80% maxmemory", note: "eviction pressure" },
  { name: "DB connections", threshold: "> 80% max", note: "pool exhaustion risk" },
  { name: "Past-due subscriptions", threshold: "> 0", note: "billing follow-up" },
];

export default async function AlertsPage() {
  await requireSection("observability");
  const alerts = await evaluateAlerts();
  const firing = new Set(alerts.map((a) => a.id));

  return (
    <>
      <PageHeader
        eyebrow="Observability"
        title="Alerts"
        subtitle="Rules evaluated live on every load — no stored state to go stale. Alert → notification → incident is the escalation path; notifications channels (email/Slack) land with the incident system."
      />

      <Panel
        title={alerts.length ? `${alerts.length} firing` : "All clear"}
        caption="currently firing, most severe first"
        flush
      >
        {alerts.length === 0 ? (
          <div className="cp-empty">
            <b>No alerts firing</b>
            Every rule below is currently satisfied.
          </div>
        ) : (
          alerts.map((a) => (
            <div className="cp-alert" key={a.id}>
              <Dot tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"} />
              <div style={{ minWidth: 0 }}>
                <div className="cp-alert-title">{a.title}</div>
                <div className="cp-alert-detail">{a.detail}</div>
              </div>
              <Link className="cp-alert-metric mono" href={a.href}>
                {a.metric} →
              </Link>
            </div>
          ))
        )}
      </Panel>

      <Panel title="Rule book" caption="what the platform watches, and why" flush>
        <div style={{ overflowX: "auto" }}>
          <table className="cp-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Threshold</th>
                <th>Intent</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const key = r.name.toLowerCase().includes("delivery")
                  ? "delivery-rate"
                  : r.name.toLowerCase().includes("complaint")
                    ? "complaints"
                    : r.name.toLowerCase().includes("bounce")
                      ? "bounces"
                      : r.name.toLowerCase().includes("queue depth")
                        ? "queue-depth"
                        : r.name.toLowerCase().includes("oldest")
                          ? "queue-age"
                          : r.name.toLowerCase().includes("redis reach")
                            ? "redis"
                            : r.name.toLowerCase().includes("redis memory")
                              ? "redis-mem"
                              : r.name.toLowerCase().includes("db")
                                ? "db-conn"
                                : "past-due";
                return (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {r.threshold}
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>{r.note}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <Dot tone={firing.has(key) ? "bad" : "ok"} />
                        {firing.has(key) ? "firing" : "clear"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
