import { NextResponse } from "next/server";
import {
  loginWithPassword,
  normalizeEmail,
  isPlausibleEmail,
  sealSessionCookie,
  sessionCookieHeader,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { sendOtpEmail } from "../../../../lib/send-auth-email";

/**
 * POST /api/auth/login { email, password }
 * Constant-time comparison, enumeration-safe error reporting.
 * If unverified, reissues code and returns { needsVerification: true, email }.
 * If verified, seals session cookie and logs in.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    password?: string;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  const password = String(body?.password ?? "");

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
    const result = await loginWithPassword(email, password);

    if (result.needsVerification) {
      if (result.code) {
        await sendOtpEmail({
          to: email,
          code: result.code,
          purpose: "verification",
        });
      }
      return NextResponse.json({
        needsVerification: true,
        email: result.email,
      });
    }

    if (!result.sessionId) {
      throw new Error("Invalid session state.");
    }

    const sealed = await sealSessionCookie(result.sessionId);
    const res = NextResponse.json({ ok: true, user: result.user });
    res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
    return res;
  } catch (err) {
    logger.warn({ err, email }, "Login failed");
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }
}
