import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  clearSessionCookieHeader,
  disconnectOAuthAccount,
  getSessionUser,
  recordSecurityEvent,
  SESSION_COOKIE,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { sameOriginRequest } from "../../../../../lib/csrf";
import { safeAuthError } from "../../../../../lib/auth-error";
import { sendSecurityEmail } from "../../../../../lib/send-security-email";

export async function POST(req: Request): Promise<Response> {
  if (!sameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }
  const session = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { provider?: string } | null;
  const provider = body?.provider;
  if (provider !== "google" && provider !== "github") {
    return NextResponse.json({ error: "Unknown OAuth provider." }, { status: 400 });
  }
  const gate = await getRateLimiter().check(
    `oauth-disconnect:user:${session.userId}`,
    rateLimitPresets.auth
  );
  if (!gate.allowed) return NextResponse.json({ error: "Try again later." }, { status: 429 });

  try {
    await disconnectOAuthAccount(session.userId, provider);
    await recordSecurityEvent({
      userId: session.userId,
      action: "auth.oauth.disconnected",
      metadata: { provider },
    }).catch(() => logger.warn("Could not record OAuth disconnect event"));
    await sendSecurityEmail({ to: session.email, event: "oauth_disconnected", provider });
    const response = NextResponse.json({ ok: true });
    // Disconnect revokes all sessions, including this one.
    response.headers.append("Set-Cookie", clearSessionCookieHeader());
    return response;
  } catch (err) {
    logger.warn({ userId: session.userId, provider }, "OAuth disconnect failed");
    return NextResponse.json(
      { error: safeAuthError(err, "Could not disconnect OAuth account.") },
      { status: 400 }
    );
  }
}
