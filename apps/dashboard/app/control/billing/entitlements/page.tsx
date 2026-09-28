import { requireSection } from "@/lib/control/guard";
import { PageHeader, Panel, Planned } from "@/control/_components/ui";

export const dynamic = "force-dynamic";

export default async function EntitlementsPage() {
  await requireSection("billing");
  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Entitlements"
        subtitle="Base plan × overrides = effective entitlements. Custom deals without custom plans."
      />
      <Panel title="Model" caption="how the system works once metering matures">
        <pre
          className="mono"
          style={{
            background: "var(--cp-bg)",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            padding: "16px 18px",
            fontSize: 12.5,
            overflowX: "auto",
            margin: "0 0 14px",
          }}
        >
          {`Customer: Acme
  Plan (base):    Pro
    50,000 emails · 10 projects · 10 domains
  Override:       +100,000 emails, +5 projects
  ─────────────────────────────────────────
  Effective:     150,000 emails · 15 projects · 10 domains`}
        </pre>
        <Planned
          title="Override engine"
          bullets={[
            "Per-organization additive overrides (+quota, +projects, +domains, +members)",
            "Temporary promotions: grant Premium for 60 days → return to Beginner (beta testers, partners, hackathon winners)",
            "Every override carries a reason and lands in the audit log",
            "Enforced at the same dimension the usage meter checks",
          ]}
        >
          Overrides are the difference between pricing you can defend and pricing that bends
          silently. The system is specified so custom deals never require inventing a new plan tier
          at 11pm.
        </Planned>
      </Panel>
    </>
  );
}
