import { describe, it, expect, afterAll } from "vitest";

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

gate("password auth integration (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, users, sessions, emailCodeChallenges } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const {
    signupWithPassword,
    loginWithPassword,
    verifySignupCode,
    resetPasswordWithCode,
    issueEmailCode,
    verifyEmailCode,
    getSessionUser,
    sealSessionCookie,
  } = await import("./index");

  const email = `pass-${randomBytes(4).toString("hex")}@test.test`;
  const initialPassword = "initial-secure-password-123";
  const newPassword = "new-updated-password-456";
  let verificationCode: string = "";

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
      .delete(emailCodeChallenges)
      .where(eq(emailCodeChallenges.email, email))
      .catch(() => {});
  });

  it("cold signup creates unverified user and returns verification code", async () => {
    if (!(await reachable())) return;
    const res = await signupWithPassword("Test User", email, initialPassword);
    expect(res.ok).toBe(true);
    expect(res.email).toBe(email);
    expect(res.code).toMatch(/^\d{6}$/);
    verificationCode = res.code!;

    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(u).toBeDefined();
    expect(u?.emailVerifiedAt).toBeNull();
    expect(u?.passwordHash).not.toBeNull();
    expect(u?.passwordHash).toContain(":");
  });

  it("unverified login redirects to code step, does not create session", async () => {
    if (!(await reachable())) return;
    const loginRes = await loginWithPassword(email, initialPassword);
    expect(loginRes.needsVerification).toBe(true);
    expect(loginRes.email).toBe(email);
    expect(loginRes.sessionId).toBeUndefined();
    expect(loginRes.code).toMatch(/^\d{6}$/);
    // Use the newly issued code
    verificationCode = loginRes.code!;
  });

  it("wrong password and unknown email produce indistinguishable errors", async () => {
    if (!(await reachable())) return;
    // Known email, wrong password
    await expect(loginWithPassword(email, "completely-wrong-password")).rejects.toThrow(
      "Invalid email or password."
    );

    // Unknown email
    await expect(
      loginWithPassword("unknown-ghost-user@example.com", "any-password-here")
    ).rejects.toThrow("Invalid email or password.");
  });

  it("submitting verification code completes signup and opens session", async () => {
    if (!(await reachable())) return;
    const verifyRes = await verifySignupCode(email, verificationCode);
    expect(verifyRes.ok).toBe(true);
    expect(typeof verifyRes.sessionId).toBe("string");

    const db = getDb();
    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(u?.emailVerifiedAt).not.toBeNull();

    const sealed = await sealSessionCookie(verifyRes.sessionId);
    const sessionUser = await getSessionUser(sealed);
    expect(sessionUser?.userId).toBe(u?.id);
    expect(sessionUser?.email).toBe(email);
  });

  it("now verified, loginWithPassword returns session directly", async () => {
    if (!(await reachable())) return;
    const loginRes = await loginWithPassword(email, initialPassword);
    expect(loginRes.needsVerification).toBe(false);
    expect(typeof loginRes.sessionId).toBe("string");
    expect(loginRes.user?.email).toBe(email);
  });

  it("password reset flow burns old password and enforces new password", async () => {
    if (!(await reachable())) return;
    const resetChallenge = await issueEmailCode(email, "reset");
    expect(resetChallenge.code).toMatch(/^\d{6}$/);

    const resetRes = await resetPasswordWithCode(email, resetChallenge.code, newPassword);
    expect(resetRes.ok).toBe(true);

    // Old password fails
    await expect(loginWithPassword(email, initialPassword)).rejects.toThrow(
      "Invalid email or password."
    );

    // New password succeeds
    const loginRes = await loginWithPassword(email, newPassword);
    expect(loginRes.needsVerification).toBe(false);
    expect(typeof loginRes.sessionId).toBe("string");
  });

  it("consumed OTP challenge cannot be reused", async () => {
    if (!(await reachable())) return;
    const ch = await issueEmailCode(email, "verification");
    await verifyEmailCode(email, ch.code, "verification");

    await expect(verifyEmailCode(email, ch.code, "verification")).rejects.toThrow(
      "This code is invalid or has expired."
    );
  });
});
