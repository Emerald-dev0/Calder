import { eq } from "drizzle-orm";
import { getDb, users } from "@calder/db";
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
 return (
 <div>
 <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Get set up</h1>
 <p style={{ color: "#737373", margin: "0 0 24px" }}>
 Six steps to your first delivered email. Progress is saved as you go, leave anytime.
 </p>
 <OnboardingWizard
 orgs={orgs}
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
