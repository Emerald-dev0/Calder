import { describe, it, expect, afterAll } from "vitest";

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

gate("magic-link integration (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, users, sessions, magicLinkTokens } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const { requestMagicLink, consumeMagicLink, getSessionUser } = await import("./index");

  const email = `mlink-${randomBytes(4).toString("hex")}@test.test`;

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (u) {
      await db
        .delete(sessions)
        .where(eq(sessions.userId, u.id))
        .catch(() => {});
      await db
        .delete(users)
        .where(eq(users.id, u.id))
        .catch(() => {});
    }
    await db
      .delete(magicLinkTokens)
      .where(eq(magicLinkTokens.email, email))
      .catch(() => {});
  });

  it("request then consume signs in and verifies the email", async () => {
    if (!(await reachable())) return;
    const raw = await requestMagicLink(email);
    expect(raw).toMatch(/^[a-f0-9]{64}$/);

    const sessionId = await consumeMagicLink(raw);
    expect(typeof sessionId).toBe("string");

    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(u).toBeDefined();
    expect(u?.emailVerifiedAt).not.toBeNull();

    const { sealSessionCookie } = await import("./index");
    const user = await getSessionUser(await sealSessionCookie(sessionId));
    expect(user?.userId).toBe(u?.id);
  });

  it("a consumed link cannot be reused", async () => {
    if (!(await reachable())) return;
    const raw = await requestMagicLink(email);
    await consumeMagicLink(raw);
    await expect(consumeMagicLink(raw)).rejects.toThrow();
  });

  it("garbage tokens are rejected", async () => {
    if (!(await reachable())) return;
    await expect(consumeMagicLink("not-a-token")).rejects.toThrow();
    await expect(consumeMagicLink("f".repeat(64))).rejects.toThrow();
  });

  it("a newer request invalidates the older link", async () => {
    if (!(await reachable())) return;
    const first = await requestMagicLink(email);
    await requestMagicLink(email);
    await expect(consumeMagicLink(first)).rejects.toThrow();
  });
});
