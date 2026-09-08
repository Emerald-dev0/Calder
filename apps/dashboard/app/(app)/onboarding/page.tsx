import { getTenantContext } from "../../../lib/auth";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage() {
  const ctx = await getTenantContext();
  const orgs = ctx.memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
  }));
  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Get set up</h1>
      <p style={{ color: "#737373", margin: "0 0 24px" }}>
        Five steps to your first delivered email. Progress is saved as you go — leave anytime.
      </p>
      <OnboardingWizard orgs={orgs} />
    </div>
  );
}
