import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb, users } from "@calder/db";
import { createSession } from "./session";
import { acceptPendingInvites, ensureFounderAccess } from "./oauth";
import { issueEmailCode, verifyEmailCode, normalizeEmail, isPlausibleEmail } from "./email-code";

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
  const [existingUser] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  const hash = await hashPassword(password);
  const trimmedName = name?.trim() || null;

  if (existingUser) {
    // If the existing user is already verified and has a password, do not leak or overwrite.
    if (existingUser.emailVerifiedAt && existingUser.passwordHash) {
      return {
        ok: true,
        email: normalized,
        code: null,
        isNewUser: false,
      };
    }

    // User exists but is unverified (or has no password yet): update password and issue verification code
    await db
      .update(users)
      .set({
        name: trimmedName || existingUser.name,
        passwordHash: hash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id));

    const challenge = await issueEmailCode(normalized, "verification");
    return {
      ok: true,
      email: normalized,
      code: challenge.code,
      isNewUser: false,
    };
  }

  // New unverified user
  const userId = newId("usr");
  await db.insert(users).values({
    id: userId,
    email: normalized,
    name: trimmedName,
    passwordHash: hash,
    emailVerifiedAt: null,
  });

  const challenge = await issueEmailCode(normalized, "verification");
  return {
    ok: true,
    email: normalized,
    code: challenge.code,
    isNewUser: true,
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
export async function loginWithPassword(
  email: string,
  password: string
): Promise<LoginWithPasswordResult> {
  const normalized = normalizeEmail(email);
  const db = getDb();

  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  const valid = await verifyPassword(password, user?.passwordHash);

  if (!valid || !user) {
    throw new Error("Invalid email or password.");
  }

  if (user.emailVerifiedAt == null) {
    // Unverified account: issue code and instruct UI to prompt for OTP
    const challenge = await issueEmailCode(normalized, "verification");
    return {
      needsVerification: true,
      email: user.email,
      code: challenge.code,
    };
  }

  await ensureFounderAccess(db, user.id, user.email);
  await acceptPendingInvites(db, user.id, user.email);

  const sessionId = await createSession(user.id);
  return {
    needsVerification: false,
    email: user.email,
    sessionId,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  };
}

/**
 * Verify a signup verification OTP code and create an authenticated session.
 */
export async function verifySignupCode(
  email: string,
  code: string
): Promise<{ ok: true; sessionId: string }> {
  const normalized = normalizeEmail(email);
  await verifyEmailCode(normalized, code, "verification");

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  if (!user) {
    throw new Error("No account found for this email.");
  }

  if (user.emailVerifiedAt == null) {
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  await ensureFounderAccess(db, user.id, user.email);
  await acceptPendingInvites(db, user.id, user.email);

  const sessionId = await createSession(user.id);
  return { ok: true, sessionId };
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
  await db
    .update(users)
    .set({
      passwordHash: newHash,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { ok: true };
}
