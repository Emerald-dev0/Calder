import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  changePassword,
  getSessionUser,
  recordSecurityEvent,
  sealSessionCookie,
  sessionCookieHeader,
  SESSION_COOKIE,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { sameOriginRequest } from "../../../../lib/csrf";
import { safeAuthError } from "../../../../lib/auth-error";
import { sendSecurityEmail } from "../../../../lib/send-security-email";

/**
 * POST /api/auth/password-change { currentPassword, newPassword }
 * Requires the current password as a step-up check. The auth package revokes
 * every prior session and returns a fresh one; this route never accepts a
 * password-only or client-selected user id.
 */
export async function POST(req: Request): Promise<Response> {
  if (!sameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }

  const session = await getSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    currentPassword?: string;
    newPassword?: string;
  } | null;
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new passwords are required." }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const [byIp, byUser] = await Promise.all([
    limiter.check(`password-change:ip:${clientIp(req)}`, rateLimitPresets.auth),
    limiter.check(`password-change:user:${session.userId}`, rateLimitPresets.auth),
  ]);
  if (!byIp.allowed || !byUser.allowed) {
    return NextResponse.json(
      { error: "Too many password changes. Try again later." },
      { status: 429 }
    );
  }

  try {
    const result = await changePassword(session.userId, currentPassword, newPassword, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
    });
    const sealed = await sealSessionCookie(result.sessionId);
    await recordSecurityEvent({
      userId: session.userId,
      action: "auth.password.changed",
      metadata: { method: "current_password" },
    }).catch(() => logger.warn("Could not record password change event"));
    await sendSecurityEmail({ to: session.email, event: "password_changed" });
    const response = NextResponse.json({ ok: true });
    response.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    return response;
  } catch (err) {
    logger.warn({ userId: session.userId }, "Password change failed");
    return NextResponse.json(
      { error: safeAuthError(err, "Password change failed.") },
      { status: 400 }
    );
  }
}
