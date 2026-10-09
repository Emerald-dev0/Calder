import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSessionUser,
  loginWithPassword,
  LoginLockedError,
  normalizeEmail,
  isPlausibleEmail,
  recordSecurityEvent,
  sealSessionCookie,
  sessionCookieHeader,
  SESSION_COOKIE,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { sendOtpEmail } from "../../../../lib/send-auth-email";
import { sendSecurityEmail } from "../../../../lib/send-security-email";
import { sameOriginRequest } from "../../../../lib/csrf";
import { postLoginRedirect } from "../../../../lib/control/post-login";

/**
 * POST /api/auth/login { email, password, next? }
 * Constant-time comparison, enumeration-safe error reporting.
 * If unverified, reissues code and returns { needsVerification: true, email }.
 * If verified, seals session cookie and logs in, returning { redirectTo } so
 * the client lands founders on /control and regular users on the dashboard.
 * The target is derived server-side from the platform-role system, never from
 * a client-side email comparison.
 */
export async function POST(req: Request): Promise<Response> {
  if (!sameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
    next?: string;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");
  const next = typeof body?.next === "string" ? body.next : null;

  if (!isPlausibleEmail(email) || !password) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const limiter = getRateLimiter();
  const ipKey = `login:ip:${clientIp(req)}`;
  const emailKey = `login:email:${email}`;

  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.auth),
    limiter.check(emailKey, rateLimitPresets.auth),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    let previousSessionId: string | undefined;
    try {
      previousSessionId = (await cookies()).get(SESSION_COOKIE)?.value;
    } catch {
      // Safe fallback when called outside Next.js request context (e.g. e2e test handler invocation)
    }
    const previous = await getSessionUser(previousSessionId);
    const result = await loginWithPassword(
      email,
      password,
      {
        userAgent: req.headers.get("user-agent"),
        ip: clientIp(req),
      },
      previous?.sessionId
    );

    if (result.needsVerification) {
      if (result.code) {
        await sendOtpEmail({
          to: email,
          code: result.code,
          purpose: "verification",
        });
      }
      // Keep the response identical to a failed password check. The code is
      // sent only after the password is valid, but the endpoint never tells a
      // caller whether an address has an account or whether its password was
      // correct.
      return NextResponse.json({ needsVerification: true, email });
    }

    if (!result.sessionId || !result.user) {
      throw new Error("Invalid session state.");
    }

    const sealed = await sealSessionCookie(result.sessionId);
    const redirectTo = await postLoginRedirect(result.email, next);
    await recordSecurityEvent({
      userId: result.user.id,
      action: "auth.login.succeeded",
      metadata: { method: "password" },
    }).catch(() => logger.warn("Could not record login security event"));
    await sendSecurityEmail({ to: result.email, event: "new_login" });
    const res = NextResponse.json({ ok: true, user: result.user, redirectTo });
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    return res;
  } catch (err) {
    // Account-level progressive lockout (M6.1): distinct from the route's
    // per-IP/per-email rate limiter — same 429 status, explicit retry hint.
    if (err instanceof LoginLockedError) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } }
      );
    }
    logger.warn("Login failed");
    // Uniform next step for an invalid password, unknown address, and an
    // unverified account. No password-validity or account-state oracle.
    return NextResponse.json({ needsVerification: true, email });
  }
}
