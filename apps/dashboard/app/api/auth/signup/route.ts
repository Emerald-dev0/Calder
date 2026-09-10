import { NextResponse } from "next/server";
import {
  signupWithPassword,
  normalizeEmail,
  isPlausibleEmail,
  validatePasswordStrength,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { sendOtpEmail } from "../../../../lib/send-auth-email";

/**
 * POST /api/auth/signup { name, email, password }
 * Registers an unverified user and emails a 6-digit verification code.
 * Enumeration-safe: always returns { ok: true, email }.
 * Rate-limited per IP (auth) and per email (otp).
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string;
    password?: string;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: "Provide a valid email address." }, { status: 400 });
  }

  const password = String(body?.password ?? "");
  const check = validatePasswordStrength(password);
  if (!check.valid) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const ipKey = `signup:ip:${clientIp(req)}`;
  const emailKey = `signup:email:${email}`;

  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.auth),
    limiter.check(emailKey, rateLimitPresets.otp),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    const res = await signupWithPassword(body?.name ?? null, email, password);
    if (res.code) {
      await sendOtpEmail({
        to: email,
        code: res.code,
        purpose: "verification",
      });
    }
  } catch (err) {
    logger.warn({ err, email }, "Signup operation failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Signup failed." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, email });
}
