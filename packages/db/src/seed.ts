import { getDb, organizations, projects } from "./index";

/**
 * Idempotent bootstrap: the founder-owned internal tenant that Calder's own
 * mail (waitlist confirmations, onboarding, billing) is sent under.
 * Safe to re-run — conflicts are ignored, nothing is overwritten.
 */
export async function seedInternalTenant(): Promise<{ orgId: string; projectId: string }> {
  const db = getDb();
  const orgId = "org_avenor";
  const projectId = "proj_website";
  await db
    .insert(organizations)
    .values({ id: orgId, name: "Calder", slug: "calder" })
    .onConflictDoNothing();
  await db
    .insert(projects)
    .values({ id: projectId, organizationId: orgId, name: "Website", slug: "website" })
    .onConflictDoNothing();
  return { orgId, projectId };
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith("seed.ts") === true;

if (invokedDirectly) {
  seedInternalTenant()
    .then(({ orgId, projectId }) => {
      console.log(`Seeded internal tenant: ${orgId} / ${projectId}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
