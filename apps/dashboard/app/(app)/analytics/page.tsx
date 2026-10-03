import { BarChart3 } from "lucide-react";
import { PlanGate } from "../../../components/plan-gate";
import { DsPageHeader, StatusPill } from "../../../components/design-system";

export const metadata = { title: "Calder — Analytics" };

export default function AnalyticsPage() {
  return (
    <div>
      <DsPageHeader
        icon={<BarChart3 size={18} />}
        title="Deliverability Analytics"
        badge={<StatusPill status="pro" label="PRO Feature" />}
        description="Understand every part of your delivery performance across domains, senders, and ISP cohorts."
      />
      <PlanGate
        title="Advanced Analytics"
        description="Delivery trends, domain performance, sender performance, open & click analytics, custom reports across your projects, computed from your own delivery events. This page never shows sample or illustrative numbers: until your plan includes analytics and real data exists, there is nothing to display."
        tier="PRO"
        features={[
          "Delivery trends",
          "Domain & sender breakdown",
          "Open & click",
          "Custom reports",
        ]}
      />
    </div>
  );
}
