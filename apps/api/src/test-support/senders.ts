import { and, eq } from "drizzle-orm";
import { domains, projects, type DbClient } from "@calder/db";

/**
 * Let a test project send live mail from a bare address.
 *
 * Stage 3.3 refuses a live send whose `from` has no sender identity unless the
 * project has opted in *and* the address's domain is verified on it. Suites
 * that exercise live-path behaviour (metering, throttling, the SES wire) send
 * from `test.test` addresses without registering a sender for each one, so
 * they opt in here — the same two data changes a customer would make in
 * Senders and Domains.
 */
export async function allowRawSenders(
  db: DbClient,
  projectId: string,
  domain = "test.test"
): Promise<void> {
  const [project] = await db
    .select({ metadata: projects.metadata })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  await db
    .update(projects)
    .set({
      metadata: { ...(project?.metadata ?? {}), allowUnattributedSenders: true },
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));

  const [existing] = await db
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.projectId, projectId), eq(domains.domain, domain)))
    .limit(1);
  if (existing) {
    await db
      .update(domains)
      .set({ status: "verified", verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(domains.id, existing.id));
    return;
  }
  await db.insert(domains).values({
    id: `dom_test_${Math.random().toString(36).slice(2, 12)}`,
    projectId,
    domain,
    status: "verified",
    verifiedAt: new Date(),
  });
}
