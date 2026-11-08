import { ComingSoon } from "../../../components/coming-soon";

export const metadata = { title: "Calder — Analytics" };

/**
 * Advanced analytics is not implemented.
 *
 * The previous page was a `PlanGate` selling "Advanced Analytics" on Pro with
 * features (open & click, custom reports, deliverability cohorts) that have no
 * implementation, no data source and no route. Upgrading could not have made
 * it work. Basic usage analytics remains real and lives on Usage.
 */
export default function AnalyticsPage() {
  return (
    <ComingSoon
      feature="advanced_analytics"
      title="Advanced Analytics"
      description="Advanced delivery and domain analytics are not implemented in this release. Your real email volume, quota and delivery counts are on the Usage page."
      alternative={{ href: "/usage", label: "Open Usage" }}
      checklist={[
        "Delivery trends and volume are live on Usage and Overview",
        "Open and click analytics depend on marketing tracking, which is not in the MVP",
        "No sample, placeholder or illustrative numbers are shown anywhere",
      ]}
    />
  );
}
