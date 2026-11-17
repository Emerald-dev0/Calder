import { describe, it, expect } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

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

/**
 * The broadcast audience, against a real database.
 *
 * This is the one predicate in the console that decides whether mail reaches a
 * person, and it is a `WHERE` clause — the least testable, most consequential
 * line in the feature. Seeding one verified and one unverified account and
 * asking the two scopes who they select is the only honest check.
 */
gate("broadcast audience (live Postgres)", async () => {
  it("selects verified-only by default and everyone on request", async () => {
    if (!(await reachable())) return;
    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { audienceWhere, parseAudience } = await import("./audience.js");

    const tag = `aud-${Date.now().toString(36)}`;
    const verifiedId = `usr_${tag}_v`;
    const unverifiedId = `usr_${tag}_u`;

    const recipients = async (scope: "verified" | "everyone" | "selected", ids: string[] = []) =>
      (
        await db.select({ id: schema.users.id }).from(schema.users).where(audienceWhere(scope, ids))
      ).map((r) => r.id);

    try {
      await db.insert(schema.users).values([
        {
          id: verifiedId,
          email: `verified-${tag}@example.test`,
          name: "Verified",
          emailVerifiedAt: new Date(),
        },
        {
          id: unverifiedId,
          email: `unverified-${tag}@example.test`,
          name: "Unverified",
          emailVerifiedAt: null,
        },
      ]);

      const verified = await recipients(parseAudience("verified"));
      expect(verified).toContain(verifiedId);
      expect(verified).not.toContain(unverifiedId);

      const everyone = await recipients(parseAudience("everyone"));
      expect(everyone).toContain(verifiedId);
      expect(everyone).toContain(unverifiedId);

      // An unknown value can never widen the audience.
      const unknown = await recipients(parseAudience("all"));
      expect(unknown).not.toContain(unverifiedId);

      // A named list is exactly that list, in both directions.
      const justOne = await recipients("selected", [verifiedId]);
      expect(justOne).toContain(verifiedId);
      expect(justOne).not.toContain(unverifiedId);

      // ...and an empty selection reaches nobody. This is the predicate that
      // would mail every customer if it ever degraded to "no filter".
      const nobody = await recipients("selected", []);
      expect(nobody).toEqual([]);
    } finally {
      await db.delete(schema.users).where(inArray(schema.users.id, [verifiedId, unverifiedId]));
    }

    const after = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, unverifiedId));
    expect(after).toEqual([]);
  });
});
