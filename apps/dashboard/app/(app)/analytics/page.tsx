import { PlanGate } from "../../../components/plan-gate";

export const metadata = { title: "Calder — Analytics" };

export default function AnalyticsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Analytics</h1>
      <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 16px" }}>
        Understand every part of your delivery performance.
      </p>
      <PlanGate
        title="Advanced Analytics"
        description="Delivery trends, domain performance, sender performance, open & click analytics, custom reports across your projects, computed from your own delivery events. This page never shows sample or illustrative numbers: until your plan includes analytics and real data exists, there is nothing to display."
        tier="PRO"
        features={["Delivery trends", "Domain & sender breakdown", "Open & click", "Custom reports"]}
      />
    </div>
  );
}
