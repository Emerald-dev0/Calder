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
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    domains,
    senderIdentities,
    emails,
    users,
  } = await import("@calder/db");
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
    archived: `sender_gone_${suffix}`,
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
      {
        id: ids.archived,
        projectId: projId,
        displayName: "Retired",
        email: `gone-${suffix}@test.test`,
        type: "domain",
        status: "verified",
        archivedAt: new Date(),
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

  it("attaches identity for known bare addresses", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const known = await resolveSender(db, projId, `hello-${suffix}@test.test`);
    expect(known.senderIdentityId).toBe(ids.verified);
  });

  it("refuses an unknown bare address on a live send, naming Senders", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const stranger = `stranger-${suffix}@test.test`;
    // The hole Stage 3.3 closes: this used to resolve to an unattributed send.
    await expect(resolveSender(db, projId, stranger)).rejects.toThrow(/Senders/);
  });

  it("allows an unknown bare address only for test-mode or platform mail", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const stranger = `stranger-${suffix}@test.test`;
    const legacy = await resolveSender(db, projId, stranger, { allowUnattributed: true });
    expect(legacy).toEqual({
      senderIdentityId: null,
      email: stranger,
      displayName: null,
    });
  });

  it("allows an unknown address at a verified domain once the project opts in", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const address = `optin-${suffix}@optin-${suffix}.test`;

    // Opt-in alone is not enough: the domain must be verified on the project.
    await db
      .update(projects)
      .set({ metadata: { allowUnattributedSenders: true } })
      .where(eq(projects.id, projId));
    await expect(resolveSender(db, projId, address)).rejects.toThrow(/Senders/);

    await db.insert(domains).values({
      id: `dom_optin_${suffix}`,
      projectId: projId,
      domain: `optin-${suffix}.test`,
      status: "verified",
      verifiedAt: new Date(),
    });
    const allowed = await resolveSender(db, projId, address);
    expect(allowed.senderIdentityId).toBeNull();
    expect(allowed.email).toBe(address);

    // A verified domain is not a blanket: another domain is still refused.
    await expect(resolveSender(db, projId, `x-${suffix}@elsewhere.test`)).rejects.toThrow(
      /Senders/
    );

    await db.delete(domains).where(eq(domains.id, `dom_optin_${suffix}`));
    await db.update(projects).set({ metadata: {} }).where(eq(projects.id, projId));
  });

  it("still refuses an unknown address at a verified domain without the opt-in", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // `test.test` is this suite's sending domain; verifying it does not by
    // itself authorise raw addresses.
    await expect(resolveSender(db, projId, `raw-${suffix}@test.test`)).rejects.toThrow(/Senders/);
  });

  it("hides archived senders from both resolution paths", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // By id: archived senders are absent from the pickable set.
    await expect(resolveSender(db, projId, ids.archived)).rejects.toThrow(/Unknown sender/);
    // By address: the legacy string path must not resurrect a retired sender.
    await expect(resolveSender(db, projId, `gone-${suffix}@test.test`)).rejects.toThrow(/archived/);
  });

  it("blocks bare addresses of disabled senders", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await expect(resolveSender(db, projId, `old-${suffix}@test.test`)).rejects.toThrow(/Re-enable/);
  });
});
