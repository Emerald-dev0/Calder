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
        subtitle="Recent audit-trail activity. Dedicated auth-abuse/credential-anomaly analytics are gated until stored as first-class security events."
      />

      <Panel
        title="Recent recorded activity"
        caption="Audit log rows (operator-visible, durable)"
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

      <Panel title="Gated capability" caption="Dedicated security event pipeline">
        <Planned
          state="gated"
          title="Security event stream"
          bullets={[
            "Auth failure spikes and credential stuffing signals",
            "API key anomaly detection with privacy-safe context",
            "Abuse-pattern aggregation and alert integration",
          ]}
        >
          Use <Link href="/control/security">Abuse</Link> and{" "}
          <Link href="/control/administration/audit-logs">Audit Logs</Link> for current durable
          signals.
        </Planned>
      </Panel>
    </>
  );
}
