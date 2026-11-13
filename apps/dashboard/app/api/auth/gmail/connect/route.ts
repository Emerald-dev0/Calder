import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE, startGmailConnect } from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { assertProjectAccess } from "../../../../(app)/onboarding/actions";
import { clientIp } from "../../../../../lib/client-ip";
import { logger } from "@calder/observability";
import { gmailGate } from "../../../../../lib/gmail-gate";

function cookie(name: string, value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax${secure}`;
}

/**
 * GET /api/auth/gmail/connect?project=ID — begin Gmail sender connect.
 *
 * Refuses before any session, rate-limit or Google work when the on-ramp is not
 * offered: the Gmail product is `coming_soon` in `@calder/config/features` (or
 * OAuth credentials are absent), so starting a real authorization flow would be
 * a promise the product does not keep. The refusal uses the same code and
 * status as the API's server-side gate — `403 feature_not_available` — so
 * there is one answer regardless of which surface is asked.
 * Project-scoped + owner/admin enforced inside saveGmailTransport; the start
 * step additionally requires membership (assertProjectAccess). Google
 * redirect URI must be registered in the OAuth console:
 * {DASHBOARD_URL}/api/auth/gmail/callback
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const onRamp = gmailGate();
  if (!onRamp.offered) {
    return NextResponse.json(
      {
        error: {
          code: "feature_not_available",
          message: onRamp.note,
          details: { feature: "gmail_integration" },
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  const projectId = url.searchParams.get("project") ?? "";
  const user = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
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
