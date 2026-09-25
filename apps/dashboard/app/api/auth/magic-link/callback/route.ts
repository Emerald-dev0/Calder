import { NextResponse } from "next/server";
import {
  consumeMagicLink,
  getSessionUser,
  sealSessionCookie,
  sessionCookieHeader,
} from "@calder/auth";
import { postLoginRedirect } from "../../../../../lib/control/post-login";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";

/**
 * M6.1: the callback consumes blindly by design (GET from any mail client),
 * so it MUST be bounded: 20 consumes/min/IP stops credential-stuffing scans
 * from burning 256-bit tokens en masse, and flagrant floods land on /login
 * with an error instead of attested sessions.
 */

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
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown";
  const gate = await getRateLimiter().check(`magiclink:${ip}`, {
    ...rateLimitPresets.auth,
    keyPrefix: "magic:consume",
  });
  if (!gate.allowed) {
    return NextResponse.redirect(new URL("/login?error=throttled", url.origin));
  }
  try {
    const sessionId = await consumeMagicLink(token, {
      userAgent: req.headers.get("user-agent"),
      ip,
    });
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
