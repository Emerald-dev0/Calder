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

gate("sender resolution (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, senderIdentities, emails, users } =
    await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const { resolveSender } = await import("./sender-service.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_snd_${suffix}`;
  const projId = `proj_snd_${suffix}`;
  const userId = `usr_snd_${suffix}`;

  const ids = {
    verified: `sender_ok_${suffix}`,
    disabled: `sender_off_${suffix}`,
    pending: `sender_wait_${suffix}`,
    otherOrg: `sender_foreign_${suffix}`,
  };

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `snd-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Sender Test", slug: `snd-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_snd_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    await db.insert(senderIdentities).values([
      {
        id: ids.verified,
        projectId: projId,
        displayName: "Calder",
        email: `hello-${suffix}@test.test`,
        type: "domain",
        status: "verified",
      },
      {
        id: ids.disabled,
        projectId: projId,
        displayName: "Old",
        email: `old-${suffix}@test.test`,
        type: "domain",
        status: "disabled",
      },
      {
        id: ids.pending,
        projectId: projId,
        displayName: "New",
        email: `new-${suffix}@test.test`,
        type: "domain",
        status: "pending",
      },
    ]);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db
      .delete(emails)
      .where(eq(emails.projectId, projId))
      .catch(() => {});
    await db
      .delete(senderIdentities)
      .where(eq(senderIdentities.projectId, projId))
      .catch(() => {});
    await db
      .delete(projects)
      .where(eq(projects.id, projId))
      .catch(() => {});
    await db
      .delete(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId))
      )
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

  it("resolves a verified sender ID to address + name", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const r = await resolveSender(db, projId, ids.verified);
    expect(r).toMatchObject({
      senderIdentityId: ids.verified,
      email: `hello-${suffix}@test.test`,
      displayName: "Calder",
    });
  });

  it("rejects unknown and foreign sender IDs as unknown", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await expect(resolveSender(db, projId, "sender_nope_123")).rejects.toThrow(/Unknown sender/);
    await expect(resolveSender(db, projId, ids.otherOrg)).rejects.toThrow(/Unknown sender/);
  });

  it("rejects disabled and pending senders with plain guidance", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await expect(resolveSender(db, projId, ids.disabled)).rejects.toThrow(/Re-enable/);
    await expect(resolveSender(db, projId, ids.pending)).rejects.toThrow(/isn't verified yet/);
  });

  it("attaches identity for known bare addresses, legacy path otherwise", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const known = await resolveSender(db, projId, `hello-${suffix}@test.test`);
    expect(known.senderIdentityId).toBe(ids.verified);
    const legacy = await resolveSender(db, projId, `stranger-${suffix}@test.test`);
    expect(legacy).toEqual({
      senderIdentityId: null,
      email: `stranger-${suffix}@test.test`,
      displayName: null,
    });
  });

  it("blocks bare addresses of disabled senders", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await expect(resolveSender(db, projId, `old-${suffix}@test.test`)).rejects.toThrow(/Re-enable/);
  });
});
