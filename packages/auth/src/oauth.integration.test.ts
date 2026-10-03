import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

process.env.RUN_INTEGRATION_TESTS ??= "";
const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

gate("OAuth disposable signup integration (live Postgres)", () => {
  const email = `oauth-${randomUUID()}@mailinator.com`;
  const providerUserId = `oauth-disposable-${randomUUID()}`;

  afterAll(async () => {
    if (!(await reachable())) return;
    const { getDb, users, sessions, oauthAccounts } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user) {
      await db
        .delete(sessions)
        .where(eq(sessions.userId, user.id))
        .catch(() => {});
      await db
        .delete(oauthAccounts)
        .where(eq(oauthAccounts.userId, user.id))
        .catch(() => {});
      await db
        .delete(users)
        .where(eq(users.id, user.id))
        .catch(() => {});
    }
  });

  it("blocks a new disposable-domain provider account before creating Calder rows", async () => {
    if (!(await reachable())) return;
    const oldClientId = process.env.GOOGLE_CLIENT_ID;
    const oldClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalFetch = globalThis.fetch;
    process.env.GOOGLE_CLIENT_ID = "oauth-test-client";
    process.env.GOOGLE_CLIENT_SECRET = "oauth-test-secret";
    const { resetConfig } = await import("@calder/config");
    resetConfig();

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(
          JSON.stringify({
            access_token: "oauth-test-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "openid profile email",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(
          JSON.stringify({
            sub: providerUserId,
            email,
            email_verified: true,
            name: "Disposable OAuth User",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected OAuth fixture request: ${url}`);
    }) as typeof fetch;

    try {
      const { completeOAuth } = await import("./oauth.js");
      await expect(
        completeOAuth("google", "fixture-code", "state-ok", "state-ok", "fixture-verifier")
      ).rejects.toThrow("This email address isn't supported. Use a different email address.");

      const { getDb, users, oauthAccounts } = await import("@calder/db");
      const { and, eq } = await import("drizzle-orm");
      const db = getDb();
      const [createdUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const [createdAccount] = await db
        .select()
        .from(oauthAccounts)
        .where(
          and(
            eq(oauthAccounts.provider, "google"),
            eq(oauthAccounts.providerUserId, providerUserId)
          )
        )
        .limit(1);
      expect(createdUser).toBeUndefined();
      expect(createdAccount).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      if (oldClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = oldClientId;
      if (oldClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = oldClientSecret;
      resetConfig();
    }
  });
});
