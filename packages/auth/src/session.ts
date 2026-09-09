import { randomBytes } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getDb, sessions, users } from "@calder/db";
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

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
}

/** Create a DB session row. Returns the session id to seal into the cookie. */
export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const id = newId("ses");
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return id;
}

/** Seal a session id for the cookie value. */
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
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
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
