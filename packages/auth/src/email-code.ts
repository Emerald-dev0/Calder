import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { eq, and, isNull, gt, desc } from "drizzle-orm";
import { getDb, emailCodeChallenges } from "@calder/db";
import { getConfig } from "@calder/config";

export type EmailCodePurpose = "verification" | "reset";

export const EMAIL_CODE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/.test(email);
}

/**
 * Legacy (v1) storage: bare sha256(code). A 6-digit code spaces 1M entries,
 * so a hashes-only leak was offline-bruteforceable in seconds (M6.1).
 */
function hashCodeLegacy(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/**
 * v2 (ADR-040): HMAC-SHA256 keyed by AUTH_SECRET, bound to purpose + email
 * so a reset code cannot be replayed as a verification code (or vice versa)
 * even with hash access, and leaked rows are useless offline.
 */
export function hashCode(code: string, purpose: string, email: string): string {
  const secret = getConfig().AUTH_SECRET;
  return createHmac("sha256", `email-code-v2|${secret}`)
    .update(`${purpose}|${email}|${code.trim()}`, "utf8")
    .digest("hex");
}

export function generateOtpCode(): string {
  return randomInt(100000, 1000000).toString();
}

export interface IssueEmailCodeResult {
  challengeId: string;
  code: string;
  expiresAt: Date;
}

/**
 * Issue a 6-digit OTP code for verification or reset.
 * Invalidates any prior live challenges for the same (email, purpose).
 * Returns the raw code to be sent via email; only sha256 is stored.
 */
export async function issueEmailCode(
  email: string,
  purpose: EmailCodePurpose
): Promise<IssueEmailCodeResult> {
  const normalized = normalizeEmail(email);
  if (!isPlausibleEmail(normalized)) {
    throw new Error("Provide a valid email.");
  }

  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MINUTES * 60 * 1000);

  // Invalidate any previous unconsumed challenges for this email + purpose
  const existing = await db
    .select({ id: emailCodeChallenges.id })
    .from(emailCodeChallenges)
    .where(
      and(
        eq(emailCodeChallenges.email, normalized),
        eq(emailCodeChallenges.purpose, purpose),
        isNull(emailCodeChallenges.consumedAt)
      )
    );

  for (const row of existing) {
    await db
      .update(emailCodeChallenges)
      .set({ consumedAt: now })
      .where(eq(emailCodeChallenges.id, row.id));
  }

  const code = generateOtpCode();
  const challengeId = newId("ecc");

  await db.insert(emailCodeChallenges).values({
    id: challengeId,
    email: normalized,
    codeHash: hashCode(code, purpose, normalized),
    purpose,
    expiresAt,
    attempts: 0,
    maxAttempts: MAX_CODE_ATTEMPTS,
  });

  return {
    challengeId,
    code,
    expiresAt,
  };
}

/**
 * Shared evaluation for verify/check: finds the live challenge, enforces the
 * attempt counter (burns after 5 failures), compares hashes in constant time.
 * Returns the matching challenge WITHOUT touching consumedAt, the caller
 * decides whether a match consumes (verify) or merely confirms (check).
 * Every failure path throws.
 */
async function evaluateChallenge(
  email: string,
  rawCode: string,
  purpose: EmailCodePurpose
): Promise<{ id: string }> {
  const normalized = normalizeEmail(email);
  const cleanCode = rawCode.trim();

  if (!/^\d{6}$/.test(cleanCode)) {
    throw new Error("Enter a valid 6-digit code.");
  }

  const db = getDb();
  const now = new Date();

  // Find the latest unconsumed, unexpired challenge for this email & purpose
  const [challenge] = await db
    .select()
    .from(emailCodeChallenges)
    .where(
      and(
        eq(emailCodeChallenges.email, normalized),
        eq(emailCodeChallenges.purpose, purpose),
        isNull(emailCodeChallenges.consumedAt),
        gt(emailCodeChallenges.expiresAt, now)
      )
    )
    .orderBy(desc(emailCodeChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    throw new Error("This code is invalid or has expired. Please request a new one.");
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    // Burn this challenge
    await db
      .update(emailCodeChallenges)
      .set({ consumedAt: now })
      .where(eq(emailCodeChallenges.id, challenge.id));
    throw new Error("Too many failed attempts. Please request a new code.");
  }

  const expectedHash = challenge.codeHash;
  // v2 first; v1 dual-accept only for challenges issued before the pepper
  // shipped (TTL ≤10m, window closed within minutes of deploy).
  const actualHashV2 = hashCode(cleanCode, challenge.purpose, challenge.email);
  const actualHashV1 = hashCodeLegacy(cleanCode);
  const expect = Buffer.from(expectedHash, "hex");
  const isMatch =
    timingSafeEqual(Buffer.from(actualHashV2, "hex"), expect) ||
    timingSafeEqual(Buffer.from(actualHashV1, "hex"), expect);

  if (!isMatch) {
    const nextAttempts = challenge.attempts + 1;
    const isExhausted = nextAttempts >= challenge.maxAttempts;
    await db
      .update(emailCodeChallenges)
      .set({
        attempts: nextAttempts,
        consumedAt: isExhausted ? now : null,
      })
      .where(eq(emailCodeChallenges.id, challenge.id));

    if (isExhausted) {
      throw new Error("Too many failed attempts. Please request a new code.");
    }
    throw new Error("Invalid code. Please check and try again.");
  }

  return { id: challenge.id };
}

/**
 * Verify a 6-digit code for a given email and purpose.
 * Enforces:
 * - single active unexpired challenge
 * - attempt counter (burns after 5 attempts)
 * - constant-time hash comparison
 * - consumes the challenge on success
 */
export async function verifyEmailCode(
  email: string,
  rawCode: string,
  purpose: EmailCodePurpose
): Promise<{ valid: boolean; challengeId: string }> {
  const challenge = await evaluateChallenge(email, rawCode, purpose);

  // Code matches! Burn challenge
  const db = getDb();
  await db
    .update(emailCodeChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(emailCodeChallenges.id, challenge.id));

  return { valid: true, challengeId: challenge.id };
}

/**
 * Check a 6-digit code WITHOUT consuming it.
 * Same identity/attempt/constant-time guarantees as verifyEmailCode, but a
 * match leaves the challenge live so a follow-up step (e.g. the final
 * password-reset call) can still consume it. Wrong codes still burn attempts.
 */
export async function checkEmailCode(
  email: string,
  rawCode: string,
  purpose: EmailCodePurpose
): Promise<{ valid: boolean; challengeId: string }> {
  const challenge = await evaluateChallenge(email, rawCode, purpose);
  return { valid: true, challengeId: challenge.id };
}
