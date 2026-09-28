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

/**
 * Phase 0, M0.3 reset step-2: checkEmailCode verifies without consuming.
 * The forgot-password flow previously advanced to the "new password" step
 * for ANY 6 digits because nothing checked the code; now step 2 checks
 * (burning attempts on failures) while the final reset call consumes.
 */
gate("checkEmailCode (live Postgres)", async () => {
  const { issueEmailCode, checkEmailCode, verifyEmailCode } = await import("./email-code.js");
  const { getDb, emailCodeChallenges } = await import("@calder/db");
  const { eq, and, isNull } = await import("drizzle-orm");

  const email = `check-code-${Math.random().toString(36).slice(2, 10)}@test.test`;

  async function liveChallengeCount(): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: emailCodeChallenges.id })
      .from(emailCodeChallenges)
      .where(and(eq(emailCodeChallenges.email, email), isNull(emailCodeChallenges.consumedAt)));
    return rows.length;
  }

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(emailCodeChallenges).where(eq(emailCodeChallenges.email, email));
  });

  it("accepts the right code without consuming the challenge", async () => {
    if (!(await reachable())) return;
    const issued = await issueEmailCode(email, "reset");

    const checked = await checkEmailCode(email, issued.code, "reset");
    expect(checked.valid).toBe(true);

    // Not consumed: still live, and verify (the consuming step) still works.
    expect(await liveChallengeCount()).toBeGreaterThanOrEqual(1);
    const verified = await verifyEmailCode(email, issued.code, "reset");
    expect(verified.valid).toBe(true);
    expect(await liveChallengeCount()).toBe(0);
  });

  it("rejects a wrong code and burns attempts", async () => {
    if (!(await reachable())) return;
    const issued = await issueEmailCode(email, "reset");
    const wrong = issued.code === "000000" ? "000001" : "000000";

    await expect(checkEmailCode(email, wrong, "reset")).rejects.toThrow(/invalid code/i);

    // The real code still validates afterwards (1 of 5 attempts burned).
    const checked = await checkEmailCode(email, issued.code, "reset");
    expect(checked.valid).toBe(true);
    // Clean up the live challenge without depending on purge order.
    await verifyEmailCode(email, issued.code, "reset");
    expect(await liveChallengeCount()).toBe(0);
  });

  it("rejects a malformed code shape before touching the database row", async () => {
    if (!(await reachable())) return;
    await expect(checkEmailCode(email, "12x4", "reset")).rejects.toThrow(/6-digit/);
  });
});
