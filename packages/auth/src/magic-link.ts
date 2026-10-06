import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, magicLinkTokens, users } from "@calder/db";
import { rotateSession, rotateSessionInTransaction } from "./session.js";
import { acceptPendingInvites, ensureFounderAccess } from "./oauth.js";
import { assertNotDisposableEmail } from "./disposable-email.js";

/** Raw magic-link token: 256 bits, hex. Only ever inside the emailed URL. */
export const MAGIC_LINK_TTL_MINUTES = 15;
export const MAGIC_LINK_FROM = "Calder <hello@calder.click>";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{2,}$/.test(email);
}

export function hashMagicToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function magicLinkExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);
}

export function isMagicTokenLive(row: { expiresAt: Date; consumedAt: Date | null }): boolean {
  return row.consumedAt == null && row.expiresAt.getTime() > Date.now();
}

/**
 * Mint a single-use login token for an email. Returns the RAW token; the
 * caller emails it. Only the sha256 hash is stored. Previous live tokens for
 * the same email are consumed so only the newest link works.
 */
export async function requestMagicLink(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!isPlausibleEmail(normalized)) throw new Error("Provide a valid email.");
  const db = getDb();
  const raw = randomBytes(32).toString("hex");
  const now = new Date();
  await db.transaction(async (tx) => {
    // Serialize issuance so concurrent resend requests cannot leave two live
    // links. The raw token remains only in the caller's email body.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`magic-link|${normalized}`}))`);
    await tx
      .update(magicLinkTokens)
      .set({ consumedAt: now })
      .where(and(eq(magicLinkTokens.email, normalized), isNull(magicLinkTokens.consumedAt)));
    await tx.insert(magicLinkTokens).values({
      id: newId("mlt"),
      email: normalized,
      tokenHash: hashMagicToken(raw),
      expiresAt: magicLinkExpiry(now),
    });
  });
  return raw;
}

/**
 * Redeem a raw token: single-use, 15-minute expiry. Links by email (receipt
 * proves ownership, so the address is marked verified), runs founder
 * bootstrap + invite auto-accept like OAuth, returns a session id.
 */
export async function consumeMagicLink(
  rawToken: string,
  meta: Parameters<typeof rotateSession>[2] = {},
  previousSessionId?: string | null
): Promise<string> {
  const raw = rawToken.trim();
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new Error("This link is invalid or expired.");
  const db = getDb();
  const [row] = await db
    .select()
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, hashMagicToken(raw)))
    .limit(1);
  if (!row || !isMagicTokenLive(row)) {
    throw new Error("This link is invalid or expired.");
  }
  // Claim the token at the database boundary. Two concurrent callbacks can
  // both read the live row, but only one conditional UPDATE returns a row.
  const claimed = await db
    .update(magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(magicLinkTokens.id, row.id),
        isNull(magicLinkTokens.consumedAt),
        gt(magicLinkTokens.expiresAt, new Date())
      )
    )
    .returning({ id: magicLinkTokens.id, email: magicLinkTokens.email });
  if (claimed.length === 0) throw new Error("This link is invalid or expired.");

  const result = await db.transaction(async (tx) => {
    const [same] = await tx
      .select()
      .from(users)
      .where(eq(users.email, row.email))
      .limit(1)
      .for("update");
    let userId = same?.id ?? null;
    if (!userId) {
      assertNotDisposableEmail(row.email);
      userId = newId("usr");
      await tx.insert(users).values({
        id: userId,
        email: row.email,
        emailVerifiedAt: new Date(),
      });
    } else if (same?.emailVerifiedAt == null) {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
    const sessionId = await rotateSessionInTransaction(tx, userId, previousSessionId, meta);
    return { userId, sessionId };
  });

  await ensureFounderAccess(db, result.userId, row.email);
  await acceptPendingInvites(db, result.userId, row.email);

  return result.sessionId;
}
