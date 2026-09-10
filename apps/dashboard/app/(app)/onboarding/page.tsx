import { eq } from "drizzle-orm";
import { getDb, users, projects, emailEvents } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage() {
  const ctx = await getTenantContext();
  const orgs = ctx.memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
  }));
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, ctx.user.userId)).limit(1);
  const me = rows[0];
  // Orgs with a prior delivered event: their celebration already happened,
  // the arrival moment is for genuine firsts only.
  const delivered = await db
    .selectDistinct({ orgId: projects.organizationId })
    .from(emailEvents)
    .innerJoin(projects, eq(emailEvents.projectId, projects.id))
    .where(eq(emailEvents.type, "delivered"));
  const orgsWithDeliveries = delivered.map((d) => d.orgId);
  return (
    <div>
      <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Get set up</h1>
      <p style={{ color: "#737373", margin: "0 0 24px" }}>
        Six steps to your first delivered email. Progress is saved as you go, leave anytime.
      </p>
      <OnboardingWizard
        orgs={orgs}
        orgsWithDeliveries={orgsWithDeliveries}
        initialProfile={{
          name: me?.name ?? "",
          username: me?.username ?? "",
          role: me?.role ?? "",
          referralSource: me?.referralSource ?? "",
        }}
      />
    </div>
  );
}
