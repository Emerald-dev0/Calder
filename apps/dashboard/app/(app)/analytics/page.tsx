import { PlanGate } from "../../../components/plan-gate";

export const metadata = { title: "Calder — Analytics" };

export default function AnalyticsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Analytics</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>Understand every part of your delivery performance.</p>
      <PlanGate
        title="Advanced Analytics"
        description="Delivery trends, domain performance, sender performance, open & click analytics, custom reports across your projects."
        tier="PRO"
        features={["Delivery trends", "Domain & sender breakdown", "Open & click", "Custom reports"]}
        preview={
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px", background: "var(--color-paper)" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>99.42%</div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Delivery</div>
            </div>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px", background: "var(--color-paper)" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>48,291</div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Delivered</div>
            </div>
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 16px", background: "var(--color-paper)" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>2.1%</div>
              <div style={{ fontSize: 11, color: "var(--color-muted)" }}>Bounced</div>
            </div>
          </div>
        }
      />
    </div>
  );
}
