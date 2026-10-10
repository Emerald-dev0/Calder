import { NextResponse } from "next/server";
import { getSessionUser, SESSION_COOKIE, startGmailConnect } from "@calder/auth";
import { getCookieValue } from "../../../../../lib/cookies";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { assertProjectAccess } from "../../../../(app)/onboarding/actions";
import { clientIp } from "../../../../../lib/client-ip";
import { logger } from "@calder/observability";

function cookie(name: string, value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax${secure}`;
}

/**
 * GET /api/auth/gmail/connect?project=ID — begin Gmail sender connect.
 * Project-scoped + owner/admin enforced inside saveGmailTransport; the start
 * step additionally requires membership (assertProjectAccess). Google
 * redirect URI must be registered in the OAuth console:
 * {DASHBOARD_URL}/api/auth/callback/gmail-connect
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project") ?? "";
  const token = await getCookieValue(SESSION_COOKIE);
  const user = await getSessionUser(token);
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  const gate = await getRateLimiter().check(`gmail-connect:start:${user.userId}:${clientIp(req)}`, {
    ...rateLimitPresets.auth,
    keyPrefix: "gmail:connect",
  });
  if (!gate.allowed)
    return NextResponse.redirect(new URL("/onboarding?notice=gmail-throttled", url.origin));
  try {
    await assertProjectAccess(projectId);
    const { url: authUrl, state, codeVerifier } = startGmailConnect();
    const res = NextResponse.redirect(authUrl);
    res.headers.append("Set-Cookie", cookie("calder_gmail_state", state));
    res.headers.append("Set-Cookie", cookie("calder_gmail_verifier", codeVerifier));
    res.headers.append("Set-Cookie", cookie("calder_gmail_project", projectId));
    return res;
  } catch {
    logger.warn("Could not start Gmail connect");
    return NextResponse.redirect(new URL("/onboarding?notice=gmail-start-failed", url.origin));
  }
}
