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

gate("auth integration (live Postgres)", async () => {
  const { randomBytes, createHash } = await import("node:crypto");
  const { getDb, users, sessions, organizationMembers, organizations, orgInvitations } =
    await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const {
    createSession,
    getSessionUser,
    revokeSession,
    sealSessionCookie,
    ensureFounderAccess,
    acceptPendingInvites,
  } = await import("./index");

  const email = `itest-${randomBytes(4).toString("hex")}@test.test`;
  const founderEmail = `founder-${randomBytes(4).toString("hex")}@test.test`;
  let userId = "";
  let founderId = "";

  beforeAll(async () => {
    if (!(await reachable())) return;
    process.env.FOUNDER_EMAILS = founderEmail;
    const { resetConfig } = await import("@calder/config");
    resetConfig();
    const db = getDb();
    userId = `usr_itest_${randomBytes(4).toString("hex")}`;
    founderId = `usr_itest_${randomBytes(4).toString("hex")}`;
    await db.insert(users).values({ id: userId, email });
    await db.insert(users).values({ id: founderId, email: founderEmail });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .catch(() => {});
    await db
      .delete(sessions)
      .where(eq(sessions.userId, founderId))
      .catch(() => {});
    await db
      .delete(organizationMembers)
      .where(eq(organizationMembers.userId, founderId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, userId))
      .catch(() => {});
    await db
      .delete(users)
      .where(eq(users.id, founderId))
      .catch(() => {});
  });

  it("round-trips: create → seal → validate → revoke → invalid", async () => {
    if (!(await reachable())) return;
    const sessionId = await createSession(userId);
    const sealed = await sealSessionCookie(sessionId);
    const who = await getSessionUser(sealed);
    expect(who?.userId).toBe(userId);
    expect(who?.email).toBe(email);
    await revokeSession(sessionId);
    expect(await getSessionUser(sealed)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const sessionId = await createSession(userId);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId));
    const sealed = await sealSessionCookie(sessionId);
    expect(await getSessionUser(sealed)).toBeNull();
  });

  it("grants founder org ownership on bootstrap, nothing for others", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await ensureFounderAccess(db, founderId, founderEmail);
    const rows = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, founderId));
    expect(rows.some((r) => r.organizationId === "org_avenor" && r.role === "owner")).toBe(true);
    // Non-founder bootstrap is a no-op (no throw, no membership).
    await ensureFounderAccess(db, userId, email);
    const plain = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));
    expect(plain.some((r) => r.organizationId === "org_avenor")).toBe(false);
  });

  it("accepts pending invites on login email match, ignores the rest", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const orgId = `org_itest_${randomBytes(4).toString("hex")}`;
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Invite Test", slug: `itest-${randomBytes(4).toString("hex")}` });
    const inviteEmail = `invited-${randomBytes(4).toString("hex")}@test.test`;
    const inviteUserId = `usr_itest_${randomBytes(4).toString("hex")}`;
    await db.insert(users).values({ id: inviteUserId, email: inviteEmail });
    await db.insert(orgInvitations).values({
      id: `inv_itest_${randomBytes(4).toString("hex")}`,
      organizationId: orgId,
      email: inviteEmail,
      role: "admin",
      tokenHash: createHash("sha256").update("test-token").digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    // Stale invite for someone else must not attach.
    await db.insert(orgInvitations).values({
      id: `inv_itest_${randomBytes(4).toString("hex")}`,
      organizationId: orgId,
      email: `stranger-${randomBytes(4).toString("hex")}@test.test`,
      role: "member",
      tokenHash: createHash("sha256").update("other-token").digest("hex"),
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const accepted = await acceptPendingInvites(db, inviteUserId, inviteEmail);
    expect(accepted).toEqual([orgId]);
    const membership = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, inviteUserId));
    expect(membership.some((m) => m.organizationId === orgId && m.role === "admin")).toBe(true);

    // Re-run is idempotent — no duplicate membership.
    await acceptPendingInvites(db, inviteUserId, inviteEmail);
    const again = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, inviteUserId));
    expect(again.filter((m) => m.organizationId === orgId)).toHaveLength(1);

    // Cleanup (org cascade clears members + invites).
    await db
      .delete(users)
      .where(eq(users.id, inviteUserId))
      .catch(() => {});
    await db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .catch(() => {});
  });
});
