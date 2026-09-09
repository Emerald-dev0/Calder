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
  const { randomBytes } = await import("node:crypto");
  const { getDb, users, sessions, organizationMembers } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { createSession, getSessionUser, revokeSession, sealSessionCookie, ensureFounderAccess } =
    await import("./index");

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
});
