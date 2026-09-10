import { NextResponse } from "next/server";
import {
  resetPasswordWithCode,
  normalizeEmail,
  isPlausibleEmail,
  validatePasswordStrength,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";

/**
 * POST /api/auth/password-reset { email, code, newPassword }
 * Burns old password and replaces with scrypt-hashed newPassword.
 * Rate-limited per IP and per email.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    code?: string;
    newPassword?: string;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  const code = String(body?.code ?? "").trim();
  const newPassword = String(body?.newPassword ?? "");

  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: "Provide a valid email address." }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter a valid 6-digit code." }, { status: 400 });
  }

  const check = validatePasswordStrength(newPassword);
  if (!check.valid) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const ipKey = `password-reset:ip:${clientIp(req)}`;
  const emailKey = `password-reset:email:${email}`;

  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.auth),
    limiter.check(emailKey, rateLimitPresets.auth),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many reset attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    await resetPasswordWithCode(email, code, newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.warn({ err, email }, "Password reset failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Password reset failed." },
      { status: 400 }
    );
  }
}
