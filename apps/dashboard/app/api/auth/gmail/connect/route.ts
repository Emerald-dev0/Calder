import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionUser, SESSION_COOKIE, startGmailConnect } from "@calder/auth";
import { assertProjectAccess } from "../../../../(app)/onboarding/actions";

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
  const user = await getSessionUser(cookies().get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));
  try {
    await assertProjectAccess(projectId);
    const { url: authUrl, state, codeVerifier } = startGmailConnect();
    const res = NextResponse.redirect(authUrl);
    res.headers.append("Set-Cookie", cookie("calder_gmail_state", state));
    res.headers.append("Set-Cookie", cookie("calder_gmail_verifier", codeVerifier));
    res.headers.append("Set-Cookie", cookie("calder_gmail_project", projectId));
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not start Gmail connect.";
    return NextResponse.redirect(
      new URL(`/onboarding?notice=${encodeURIComponent(`gmail-start:${msg}`)}`, url.origin)
    );
  }
}
