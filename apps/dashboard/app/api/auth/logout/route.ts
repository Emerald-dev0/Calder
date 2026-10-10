import { NextResponse } from "next/server";
import {
  getSessionUser,
  recordSecurityEvent,
  revokeSession,
  clearSessionCookieHeader,
  SESSION_COOKIE,
} from "@calder/auth";
import { sameOriginRequest } from "../../../../lib/csrf";
import { getCookieValue } from "../../../../lib/cookies";

export async function POST(req: Request): Promise<Response> {
  if (!sameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }
  const token = await getCookieValue(SESSION_COOKIE);
  const user = await getSessionUser(token);
  if (user) {
    await revokeSession(user.sessionId);
    await recordSecurityEvent({ userId: user.userId, action: "auth.logout" }).catch(() => {});
  }
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.headers.append("Set-Cookie", clearSessionCookieHeader());
  return res;
}
