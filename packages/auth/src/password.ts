import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, sessions, users } from "@calder/db";
import { createSession, rotateSessionInTransaction } from "./session.js";
import { acceptPendingInvites, ensureFounderAccess } from "./oauth.js";
import { issueEmailCode, verifyEmailCode, normalizeEmail, isPlausibleEmail } from "./email-code.js";
import { assertNotDisposableEmail } from "./disposable-email.js";

/**
 * Scrypt parameters: N=16384, r=8, p=1, 64-byte key.
 * Industry standard secure defaults via node:crypto (zero new dependencies).
 */
export const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

export const KEY_LEN = 64;
export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 128;

// Fixed dummy salt + key for constant-time comparison when email or password_hash is absent
const DUMMY_SALT = "a".repeat(32);
const DUMMY_HASH_KEY = "b".repeat(KEY_LEN * 2);
const DUMMY_HASH = `${DUMMY_SALT}:${DUMMY_HASH_KEY}`;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (typeof password !== "string") {
    return { valid: false, reason: "Password must be a string." };
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return { valid: false, reason: `Password must be at least ${MIN_PASSWORD_LEN} characters.` };
  }
  if (password.length > MAX_PASSWORD_LEN) {
    return { valid: false, reason: `Password must not exceed ${MAX_PASSWORD_LEN} characters.` };
  }
  return { valid: true };
}

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Hash a plaintext password with a random 16-byte salt using scrypt.
 * Output format: "<salt_hex>:<derived_key_hex>"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt);
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Verify a plaintext password against a stored hash using timingSafeEqual.
 * Always performs scrypt calculation even if storedHash is missing/invalid,
 * making unknown emails and incorrect passwords timing-indistinguishable.
 */
export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  const targetHash = storedHash && storedHash.includes(":") ? storedHash : DUMMY_HASH;
  const parts = targetHash.split(":");
  const salt = parts[0] || DUMMY_SALT;
  const expectedKeyHex = parts[1] || DUMMY_HASH_KEY;

  const derivedKey = await scryptAsync(password, salt);
  const expectedKey = Buffer.from(expectedKeyHex, "hex");

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  const matches = timingSafeEqual(derivedKey, expectedKey);

  // If we fell back to the dummy hash, always return false
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }

  return matches;
}

export interface SignupWithPasswordResult {
  ok: true;
  email: string;
  code: string | null;
  isNewUser: boolean;
}

/**
 * Sign up a user with email + password:
 * 1. Validate inputs
 * 2. Hash password with scrypt
 * 3. Create unverified user if new, or update unverified user
 * 4. Issue a 6-digit email OTP challenge
 * 5. Returns code to send via branded email
 */
export async function signupWithPassword(
  name: string | null,
  email: string,
  password: string
): Promise<SignupWithPasswordResult> {
  const normalized = normalizeEmail(email);
  if (!isPlausibleEmail(normalized)) {
    throw new Error("Provide a valid email address.");
  }

  const check = validatePasswordStrength(password);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const db = getDb();
  const [snapshot] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  // Existing verified accounts retain the enumeration-safe no-op behavior.
  if (snapshot?.emailVerifiedAt && snapshot.passwordHash) {
    return { ok: true, email: normalized, code: null, isNewUser: false };
  }

  assertNotDisposableEmail(normalized);
  const hash = await hashPassword(password);
  const trimmedName = name?.trim() || null;

  // Re-check and mutate under the user-row lock. A concurrent verification or
  // OAuth link must not turn an initially-unverified read into a password
  // overwrite after the account has become verified. ON CONFLICT also handles
  // two first-time signups for the same address without creating two users.
  const outcome = await db.transaction(async (tx) => {
    let [existingUser] = await tx
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)
      .for("update");

    if (!existingUser) {
      const [created] = await tx
        .insert(users)
        .values({
          id: newId("usr"),
          email: normalized,
          name: trimmedName,
          passwordHash: hash,
          emailVerifiedAt: null,
        })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (created) return { issueCode: true, isNewUser: true };
      [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalized))
        .limit(1)
        .for("update");
    }

    // Existing verified accounts retain the enumeration-safe no-op behavior.
    if (existingUser?.emailVerifiedAt && existingUser.passwordHash) {
      return { issueCode: false, isNewUser: false };
    }
    if (!existingUser) throw new Error("Could not create account.");

    // User exists but is unverified (or has no password yet): update password
    // and revoke old sessions in the same transaction before issuing a code.
    await tx
      .update(users)
      .set({
        name: trimmedName || existingUser.name,
        passwordHash: hash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, existingUser.id), isNull(sessions.revokedAt)));
    return { issueCode: true, isNewUser: false };
  });

  if (!outcome.issueCode) {
    return { ok: true, email: normalized, code: null, isNewUser: false };
  }
  const challenge = await issueEmailCode(normalized, "verification");
  return {
    ok: true,
    email: normalized,
    code: challenge.code,
    isNewUser: outcome.isNewUser,
  };
}

export interface LoginWithPasswordResult {
  needsVerification: boolean;
  email: string;
  code?: string;
  sessionId?: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
}

/**
 * Log in a user with email + password:
 * 1. Constant-time compare password
 * 2. If mismatch or user absent -> throw enumeration-safe error
 * 3. If unverified -> issue verification code and return needsVerification: true
 * 4. If verified -> run founder bootstrap + accept invites + createSession
 */
/**
 * M6.1 progressive lockout (ADR-040): consecutive failures raise a
 * temporary lock before the password check even runs. Delays grow
 * exponentially (30s → 1m → 2m → 4m … capped at 30m), never past the
 * stored user row (no shadow state for unknown emails — enumeration-safe).
 */
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_CAP_MS = 30 * 60_000;

export function lockoutDelayMs(failedAttempts: number): number {
  if (failedAttempts < 3) return 0; // below threshold: no lock
  const exp = Math.min(failedAttempts - 3, 10);
  return Math.min(LOCKOUT_BASE_MS * 2 ** exp, LOCKOUT_CAP_MS);
}

export class LoginLockedError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Too many failed sign-in attempts. Try again in ${retryAfterSec}s.`);
    this.name = "LoginLockedError";
    this.retryAfterSec = retryAfterSec;
  }
}

export async function loginWithPassword(
  email: string,
  password: string,
  meta: Parameters<typeof createSession>[1] = {},
  previousSessionId?: string | null
): Promise<LoginWithPasswordResult> {
  const normalized = normalizeEmail(email);
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  // Lockout check BEFORE the scrypt compare: a locked account neither burns
  // CPU for attackers nor reveals validity through timing changes.
  if (user && user.lockedUntil && user.lockedUntil > new Date()) {
    throw new LoginLockedError(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
  }

  const valid = await verifyPassword(password, user?.passwordHash);

  if (!valid || !user) {
    if (user) {
      // Re-read and lock the user row before incrementing. An optimistic
      // compare alone lets concurrent guesses lose increments and weakens the
      // brute-force control under a burst of requests.
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: users.id,
            failedLoginAttempts: users.failedLoginAttempts,
            lockedUntil: users.lockedUntil,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
          .for("update");
        if (!current) return { kind: "invalid" as const };
        if (current.lockedUntil && current.lockedUntil > new Date()) {
          return {
            kind: "locked" as const,
            retryAfterSec: Math.ceil((current.lockedUntil.getTime() - Date.now()) / 1000),
          };
        }
        const attempts = (current.failedLoginAttempts ?? 0) + 1;
        const delay = lockoutDelayMs(attempts);
        await tx
          .update(users)
          .set({
            failedLoginAttempts: attempts,
            lockedUntil: delay > 0 ? new Date(Date.now() + delay) : null,
          })
          .where(eq(users.id, current.id));
        return delay > 0
          ? { kind: "locked" as const, retryAfterSec: Math.ceil(delay / 1000) }
          : { kind: "invalid" as const };
      });
      if (result.kind === "locked") throw new LoginLockedError(result.retryAfterSec);
    }
    throw new Error("Invalid email or password.");
  }

  // Re-check the password and lockout state while holding the user row lock.
  // This closes the race with a concurrent password change or failed-login
  // burst before a session is issued.
  const authenticated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
      .for("update");
    if (!current || current.passwordHash !== user.passwordHash) {
      throw new Error("Invalid email or password.");
    }
    if (current.lockedUntil && current.lockedUntil > new Date()) {
      throw new LoginLockedError(Math.ceil((current.lockedUntil.getTime() - Date.now()) / 1000));
    }
    const now = new Date();
    await tx
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(users.id, current.id));
    if (current.emailVerifiedAt == null) {
      return {
        needsVerification: true as const,
        email: current.email,
        userId: current.id,
        name: current.name,
      };
    }
    const sessionId = await rotateSessionInTransaction(tx, current.id, previousSessionId, meta);
    return {
      needsVerification: false as const,
      email: current.email,
      userId: current.id,
      name: current.name,
      sessionId,
    };
  });

  if (authenticated.needsVerification) {
    // Unverified account: issue code and instruct UI to prompt for OTP.
    const challenge = await issueEmailCode(normalized, "verification");
    return {
      needsVerification: true,
      email: authenticated.email,
      code: challenge.code,
    };
  }

  await ensureFounderAccess(db, authenticated.userId, authenticated.email);
  await acceptPendingInvites(db, authenticated.userId, authenticated.email);

  return {
    needsVerification: false,
    email: authenticated.email,
    sessionId: authenticated.sessionId,
    user: {
      id: authenticated.userId,
      email: authenticated.email,
      name: authenticated.name,
    },
  };
}

/**
 * Verify a signup verification OTP code and create an authenticated session.
 */
export async function verifySignupCode(
  email: string,
  code: string,
  meta: Parameters<typeof createSession>[1] = {},
  previousSessionId?: string | null
): Promise<{ ok: true; sessionId: string }> {
  const normalized = normalizeEmail(email);
  await verifyEmailCode(normalized, code, "verification");

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1)
      .for("update");
    if (!user) throw new Error("No account found for this email.");
    const now = new Date();
    if (user.emailVerifiedAt == null) {
      await tx
        .update(users)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(eq(users.id, user.id));
    }
    const sessionId = await rotateSessionInTransaction(tx, user.id, previousSessionId, meta);
    return { userId: user.id, email: user.email, sessionId };
  });

  await ensureFounderAccess(db, result.userId, result.email);
  await acceptPendingInvites(db, result.userId, result.email);
  return { ok: true, sessionId: result.sessionId };
}

/**
 * Reset password using a valid reset OTP code. Burns old password and updates emailVerifiedAt.
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string
): Promise<{ ok: true }> {
  const normalized = normalizeEmail(email);
  const check = validatePasswordStrength(newPassword);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  // Verify code burns challenge
  await verifyEmailCode(normalized, code, "reset");

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  if (!user) {
    throw new Error("No account found for this email.");
  }

  const newHash = await hashPassword(newPassword);
  // Reset revokes EVERY session (ADR-040) in the same transaction as the
  // password replacement: the mailbox is the recovery oracle, so a code
  // redeem proves possession and kills all prior devices without a gap.
  await db.transaction(async (tx) => {
    // Serialize reset with every session creation/revocation path. Without
    // the user-row lock, a concurrent login could insert a live session after
    // the reset's revoke sweep committed.
    const [lockedUser] = await tx
      .select({ id: users.id, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
      .for("update");
    if (!lockedUser) throw new Error("No account found for this email.");
    const now = new Date();
    await tx
      .update(users)
      .set({
        passwordHash: newHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        emailVerifiedAt: lockedUser.emailVerifiedAt ?? now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id));
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
  });

  return { ok: true };
}

/**
 * Change a password only after re-authenticating with the current password.
 * All existing sessions are revoked in the same transaction that issues the
 * replacement session, preventing a stolen old session from surviving the
 * change. The caller must send the returned id in a new cookie.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: Parameters<typeof createSession>[1] = {}
): Promise<{ ok: true; sessionId: string }> {
  const check = validatePasswordStrength(newPassword);
  if (!check.valid) throw new Error(check.reason);
  if (currentPassword === newPassword) {
    throw new Error("New password must be different from the current password.");
  }

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const valid = await verifyPassword(currentPassword, user?.passwordHash);
  if (!user || !valid) throw new Error("Current password is incorrect.");

  const newHash = await hashPassword(newPassword);
  const sessionId = newId("ses");
  await db.transaction(async (tx) => {
    const [lockedUser] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    // The password was checked before entering the transaction. Re-check the
    // stored hash after acquiring the lock so two concurrent password changes
    // cannot both authenticate against the same old hash and overwrite one
    // another's result.
    if (!lockedUser || lockedUser.passwordHash !== user.passwordHash) {
      throw new Error("Current password is incorrect.");
    }
    const now = new Date();
    await tx
      .update(users)
      .set({
        passwordHash: newHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      })
      .where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await tx.insert(sessions).values({
      id: sessionId,
      userId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip ?? null,
    });
  });
  return { ok: true, sessionId };
}
