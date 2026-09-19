import { NextResponse } from "next/server";
import {
  verifySignupCode,
  checkEmailCode,
  normalizeEmail,
  isPlausibleEmail,
  sealSessionCookie,
  sessionCookieHeader,
  type EmailCodePurpose,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { clientIp } from "../../../../../lib/client-ip";
import { postLoginRedirect } from "../../../../../lib/control/post-login";

/**
 * POST /api/auth/email-code/verify { email, code, purpose, next? }
 * Verifies a 6-digit OTP challenge.
 * If verification: marks email verified, creates session, sets cookie, and
 * returns { redirectTo } derived server-side from the platform-role system
 * (founders land on /control).
 * If reset: confirms code is valid for reset.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    code?: string;
    purpose?: EmailCodePurpose;
    next?: string;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  const code = String(body?.code ?? "").trim();
  const purpose: EmailCodePurpose = body?.purpose === "reset" ? "reset" : "verification";
  const next = typeof body?.next === "string" ? body.next : null;

  if (!isPlausibleEmail(email) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid 6-digit code." }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const ipKey = `verify-code:ip:${clientIp(req)}`;
  const emailKey = `verify-code:email:${email}`;

  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.otp),
    limiter.check(emailKey, rateLimitPresets.otp),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    if (purpose === "verification") {
      const result = await verifySignupCode(email, code);
      const sealed = await sealSessionCookie(result.sessionId);
      const redirectTo = await postLoginRedirect(email, next);
      const res = NextResponse.json({ ok: true, redirectTo });
      res.headers.append("Set-Cookie", sessionCookieHeader(sealed, 30 * 24 * 60 * 60));
      return res;
    }

    // Password reset step 2: ACTUALLY verify the code, but without consuming
    // it, the final POST /api/auth/password-reset consumes the same challenge.
    // (Previously this branch returned ok for ANY code, which let the UI's
    // step 2 pretend the code was checked.) A wrong code is a 400 here and
    // still burns one of the 5 allowed attempts.
    await checkEmailCode(email, code, "reset");
    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed." },
      { status: 400 }
    );
  }
}
