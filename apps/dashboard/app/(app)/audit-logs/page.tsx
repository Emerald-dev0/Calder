import { PlanGate } from "../../../components/plan-gate";

export const metadata = { title: "Calder — Audit Logs" };

export default function AuditLogsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Audit Logs</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Track every organization and security change.</p>
      <PlanGate
        title="Audit logs are available on Premium"
        description="Track API key changes, domain changes, project configuration, team permissions, and security events with actor, timestamp, and IP."
        tier="PREMIUM"
        features={["Actor + action + resource", "Timestamp + IP", "Security events", "90-day retention"]}
      />
    </div>
  );
}
