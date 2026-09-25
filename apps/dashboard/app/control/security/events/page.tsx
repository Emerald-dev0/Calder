import Link from "next/link";
import { fmtAgo } from "@/lib/control/format";
import { requireSection } from "@/lib/control/guard";
import { securityEvents } from "@/lib/control/queries";
import { Empty, PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function SecurityEventsPage() {
  await requireSection("security");
  const events = await securityEvents();

  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Security Events"
        subtitle="Authentication anomalies, credential abuse, and platform-level security signals."
      />

      <Panel
        title="Recent recorded activity"
        caption="from the audit trail — the events captured today"
        flush
      >
        {events.length === 0 ? (
          <Empty title="Nothing recorded" />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cp-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.audit.id}>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {e.audit.action}
                    </td>
                    <td style={{ color: "var(--cp-muted)" }}>{e.actorEmail ?? "system"}</td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {e.audit.targetType ?? "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--cp-muted)" }}>
                      {fmtAgo(new Date(e.audit.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Planned: dedicated security event pipeline"
        caption="auth failures, key anomalies, signup abuse"
      >
        <Planned
          title="Security event stream"
          bullets={[
            "Auth failure spikes per IP / email (rate limiter already counts them)",
            "Compromised API key signals: sudden geo + volume shifts",
            "Suspicious signup bursts (disposable domains, temp-mail patterns)",
            "Alert integration with the rule book",
          ]}
        >
          Today the durable security signals are rate-limiter counters and the audit trail. The
          dedicated stream (with retention separate from operational logs) is tracked in the
          roadmap. <Link href="/control/security">Back to Abuse →</Link>
        </Planned>
      </Panel>
    </>
  );
}
