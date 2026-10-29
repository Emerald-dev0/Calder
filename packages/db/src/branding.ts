import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import { projects } from "./schema/projects.js";
import { domains } from "./schema/domains.js";
import { resolveOrgTier } from "./usage.js";

/** A fresh, fail-closed delivery-time decision. Unknown plans are branded. */
export async function mayRemoveCalderBranding(db: DbExecutor, projectId: string): Promise<boolean> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.metadata?.removeCalderBranding !== true) return false;
  const tier = await resolveOrgTier(db, project.organizationId);
  if (!["starter", "pro", "premium", "scale"].includes(tier)) return false;
  const [domain] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.projectId, projectId), eq(domains.status, "verified")))
    .limit(1);
  return !!domain;
}
