import { NextResponse } from "next/server";
import {
  consumeMagicLink,
  getSessionUser,
  sealSessionCookie,
  sessionCookieHeader,
} from "@calder/auth";
import { postLoginRedirect } from "../../../../../lib/control/post-login";

/**
 * GET /api/auth/magic-link/callback?token=… — redeem a one-time sign-in link.
 * Consumes the token (single-use), links-or-creates the user, seals the
 * session, enters the app (founders land on /control via the server-side
 * platform-role check). Failures land back on /login with an error flag,
 * never a stack trace.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  try {
    const sessionId = await consumeMagicLink(token);
    const sealed = await sealSessionCookie(sessionId);
    const sessionUser = await getSessionUser(sealed);
    const target = sessionUser ? await postLoginRedirect(sessionUser.email) : "/";
    const res = NextResponse.redirect(new URL(target, url.origin));
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    return res;
  } catch {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }
}

export async function POST(): Promise<Response> {
  return NextResponse.json({ error: "Use the link from your email." }, { status: 405 });
}
