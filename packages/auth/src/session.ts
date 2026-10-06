import { randomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { eq, and, isNull, gt, sql, desc } from "drizzle-orm";
import { getDb, sessions, users, type DbTransaction } from "@calder/db";
import { getConfig } from "@calder/config";

export const SESSION_COOKIE = "calder_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days idle

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function sealPassword(): string {
  const secret = getConfig().AUTH_SECRET;
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return secret;
}

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
}

/** Lock the parent user row before changing session state. */
async function lockUser(tx: DbTransaction, userId: string): Promise<void> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!row) throw new Error("Account not found.");
}

async function insertSession(
  tx: DbTransaction,
  userId: string,
  meta: SessionMeta,
  now = new Date()
) {
  const id = newId("ses");
  await tx.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    ip: meta.ip ?? null,
  });
  return id;
}

/** Create a DB session row. Returns the session id to seal into the cookie. */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    // Session creation participates in the same user-row lock as password
    // reset/change and revoke-all. This prevents a login racing a security
    // invalidation from creating a live row after the revocation sweep.
    await lockUser(tx, userId);
    return insertSession(tx, userId, meta);
  });
}

/**
 * Rotate the browser's authenticated session at a trust-boundary transition.
 * The old row is revoked and the new row is inserted in one transaction, so a
 * fixed or replayed session id cannot remain live after authentication. The
 * previous id is intentionally not required to belong to the new user: a
 * browser can sign out one account and sign in to another without retaining
 * the old account's live session.
 */
export async function rotateSessionInTransaction(
  tx: DbTransaction,
  userId: string,
  previousSessionId: string | null | undefined,
  meta: SessionMeta = {}
): Promise<string> {
  await lockUser(tx, userId);
  if (previousSessionId) {
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, previousSessionId), isNull(sessions.revokedAt)));
  }
  return insertSession(tx, userId, meta);
}

export async function rotateSession(
  userId: string,
  previousSessionId: string | null | undefined,
  meta: SessionMeta = {}
): Promise<string> {
  const db = getDb();
  return db.transaction((tx) => rotateSessionInTransaction(tx, userId, previousSessionId, meta));
}

/**
 * Revoke every live session and issue exactly one fresh session. Used after a
 * password change, where retaining any other device would defeat the
 * security-sensitive invalidation guarantee.
 */
export async function rotateAllSessions(userId: string, meta: SessionMeta = {}): Promise<string> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    return insertSession(tx, userId, meta);
  });
}

/** Seal a session id for the cookie. */
export async function sealSessionCookie(sessionId: string): Promise<string> {
  return sealData({ sessionId }, { password: sealPassword() });
}

/** Unseal cookie → validate row (expiry + revocation) → user. Null = signed out. */
export async function getSessionUser(
  cookieValue: string | null | undefined
): Promise<SessionUser | null> {
  if (!cookieValue) return null;
  let payload: { sessionId?: string };
  try {
    payload = await unsealData<{ sessionId?: string }>(cookieValue, { password: sealPassword() });
  } catch {
    return null;
  }
  if (!payload.sessionId) return null;
  const db = getDb();
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.id, payload.sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Touch last_seen, throttled: at most one write per session per 5 minutes
  // keeps inventory fresh without write-amplifying every request.
  const seen = row.session.lastSeenAt;
  if (!seen || Date.now() - seen.getTime() > 5 * 60_000) {
    db.update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(sessions.id, row.session.id),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      .catch(() => {});
  }
  return {
    sessionId: row.session.id,
    userId: row.user.id,
    email: row.user.email,
    name: row.user.name,
  };
}

/** Revoke now (logout everywhere for this session). */
export async function revokeSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** M6.1 session inventory: all live sessions for one user, freshest first. */
export async function listLiveSessions(userId: string) {
  const db = getDb();
  return (
    db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      // Most recently active sessions first; null legacy timestamps go last in
      // PostgreSQL's DESC ordering, with creation time as a deterministic tie-break.
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt))
  );
}

/** Revoke one session owned by this user (inventory self-service). */
export async function revokeOwnSession(userId: string, sessionId: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return res.length > 0;
}

/** Sign out everywhere else: revoke all live sessions except `keepSessionId`. */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const res = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          // Keep the caller's own session alive.
          sql`${sessions.id} != ${keepSessionId}`
        )
      )
      .returning({ id: sessions.id });
    return res.length;
  });
}

/** Nuclear option: every session dies (password reset, account takeover). */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await lockUser(tx, userId);
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}

/** "; Secure" in production, empty locally (Secure cookies need HTTPS). */
export function secureFlag(): string {
  return getConfig().NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookieHeader(sealed: string, maxAgeSec: number): string {
  return [
    `${SESSION_COOKIE}=${sealed}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAgeSec}`,
    `SameSite=Lax${secureFlag()}`,
  ].join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secureFlag()}`;
}
