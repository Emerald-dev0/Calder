import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

gate("gmail sender auto-provision (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, users, organizations, organizationMembers, projects, senderIdentities } =
    await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { saveGmailTransport } = await import("./gmail-connect");

  const suffix = randomBytes(4).toString("hex");
  const userId = `usr_gml_${suffix}`;
  const orgId = `org_gml_${suffix}`;
  const projId = `proj_gml_${suffix}`;
  const gmail = `human-${suffix}@gmail.com`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    // Auth encryption needs a secret; tests use a throwaway.
    process.env.AUTH_SECRET ??= `test-secret-${suffix}-long-enough-32-chars`;
    const { resetConfig } = await import("@calder/config");
    resetConfig();
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `owner-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "G", slug: `gml-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_gml_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db
      .delete(senderIdentities)
      .where(eq(senderIdentities.projectId, projId))
      .catch(() => {});
    const { projectTransports } = await import("@calder/db");
    await db
      .delete(projectTransports)
      .where(eq(projectTransports.projectId, projId))
      .catch(() => {});
    await db
      .delete(projects)
      .where(eq(projects.id, projId))
      .catch(() => {});
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgId))
      .catch(() => {});
    await db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, userId))
      .catch(() => {});
  });

  it("connecting Gmail mints a connected sender identity", async () => {
    if (!(await reachable())) return;
    const { transportId, senderId } = await saveGmailTransport({
      userId,
      projectId: projId,
      senderEmail: gmail,
      refreshToken: "rt_test_token",
    });
    expect(transportId).toMatch(/^tr_/);
    expect(senderId).toMatch(/^sender_/);
    const db = getDb();
    const [row] = await db
      .select()
      .from(senderIdentities)
      .where(eq(senderIdentities.id, senderId ?? ""))
      .limit(1);
    expect(row?.email).toBe(gmail);
    expect(row?.status).toBe("connected");
    expect(row?.transportId).toBe(transportId);
    expect(row?.isDefault).toBe(true);
  });

  it("reconnecting the same address is idempotent", async () => {
    if (!(await reachable())) return;
    const first = await saveGmailTransport({
      userId,
      projectId: projId,
      senderEmail: gmail,
      refreshToken: "rt_test_token_2",
    });
    const db = getDb();
    const rows = await db
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(eq(senderIdentities.projectId, projId));
    expect(rows.map((r) => r.id)).toContain(first.senderId);
    expect(rows.length).toBe(1);
  });
});
