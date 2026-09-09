import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, users } from "@calder/db";
import { getConfig } from "@calder/config";
import {
  createSession,
  ensureFounderAccess,
  acceptPendingInvites,
  sealSessionCookie,
  sessionCookieHeader,
} from "@calder/auth";

/**
 * DEV-ONLY login bypass so the founder can preview the dashboard before
 * OAuth provider credentials exist. Fails closed: 403 unless BOTH
 * NODE_ENV=development AND ALLOW_DEV_LOGIN=true. Never enable in production,
 * this route creates sessions for any email address.
 */
export async function POST(req: Request): Promise<Response> {
  const config = getConfig();
  if (config.NODE_ENV === "production" || process.env.ALLOW_DEV_LOGIN !== "true") {
    return NextResponse.json({ error: "Dev login is disabled." }, { status: 403 });
  }
  const contentType = req.headers.get("content-type") ?? "";
  let email = "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    email = body?.email?.toLowerCase().trim() ?? "";
  } else {
    const form = await req.formData().catch(() => null);
    email = String(form?.get("email") ?? "")
      .toLowerCase()
      .trim();
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "Provide a valid email." }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id ?? null;
  if (!userId) {
    userId = `usr_${randomBytes(12).toString("hex")}`;
    await db.insert(users).values({ id: userId, email, emailVerifiedAt: new Date() });
  }
  await ensureFounderAccess(db, userId, email);
  await acceptPendingInvites(db, userId, email);

  const sessionId = await createSession(userId);
  const sealed = await sealSessionCookie(sessionId);
  const res = NextResponse.redirect(new URL("/", req.url));
  res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
  return res;
}
