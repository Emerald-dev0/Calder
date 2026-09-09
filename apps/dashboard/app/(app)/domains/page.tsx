import { desc, eq } from "drizzle-orm";
import { getDb, domains } from "@calder/db";
import { getTenantContext, resolveProject } from "../../../lib/auth";
import { ProjectPicker } from "../project-picker";
import { DomainAdder, DomainRow } from "./manager";

export default async function DomainsPage({
 searchParams,
}: {
 searchParams: { project?: string };
}) {
 const ctx = await getTenantContext();
 const projects = ctx.memberships.flatMap((m) => m.projects);
 const scope = resolveProject(ctx, searchParams.project);
 if (!scope) {
 return (
 <div>
 <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Domains</h1>
 <p style={{ color: "#737373" }}>No project found. Complete onboarding first.</p>
 </div>
 );
 }
 const db = getDb();
 const rows = await db
 .select()
 .from(domains)
 .where(eq(domains.projectId, scope.project.id))
 .orderBy(desc(domains.createdAt));

 return (
 <div>
 <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Domains</h1>
 <p style={{ color: "#737373", margin: "0 0 20px", fontSize: 14 }}>
 Verified identities this project may send from.
 </p>
 <ProjectPicker
 projects={projects.map((p) => ({ id: p.id, slug: p.slug }))}
 currentId={scope.project.id}
 basePath="/domains"
 />
 <DomainAdder projectId={scope.project.id} />
 <div
 style={{
 background: "#fff",
 border: "1px solid #E5E5E5",
 borderRadius: 12,
 overflow: "hidden",
 }}
 >
 {rows.length === 0 && (
 <p style={{ padding: 20, color: "#737373", fontSize: 14, margin: 0 }}>
 No domains yet. Add yours above, paste the three DNS records, and you can send as
 you@yourproduct.com.
 </p>
 )}
 {rows.map((d, i) => (
 <div key={d.id} style={{ borderTop: i === 0 ? "none" : "1px solid #F0F0F0" }}>
 <DomainRow
 domain={{
 id: d.id,
 domain: d.domain,
 status: d.status,
 verificationToken: d.verificationToken,
 }}
 />
 </div>
 ))}
 </div>
 </div>
 );
}
