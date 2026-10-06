import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users } from "@calder/db";
import {
  normalizeEmail,
  recordSecurityEvent,
  resetPasswordWithCode,
  isPlausibleEmail,
  validatePasswordStrength,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { safeAuthError } from "../../../../lib/auth-error";
import { sendSecurityEmail } from "../../../../lib/send-security-email";
import { sameOriginRequest } from "../../../../lib/csrf";

/**
 * POST /api/auth/password-reset { email, code, newPassword }
 * Burns old password and replaces with scrypt-hashed newPassword.
 * Rate-limited per IP and per email.
 */
export async function POST(req: Request): Promise<Response> {
  if (!sameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request denied." }, { status: 403 });
  }
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
    const [user] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (user) {
      await recordSecurityEvent({
        userId: user.id,
        action: "auth.password.reset",
        metadata: { method: "email_code" },
      }).catch(() => logger.warn("Could not record password reset event"));
      await sendSecurityEmail({ to: email, event: "password_reset" });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.warn("Password reset failed");
    // Enumeration-safe: an unknown email looks exactly like success, so the
    // endpoint never reveals which addresses hold accounts.
    if (err instanceof Error && err.message === "No account found for this email.") {
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: safeAuthError(err, "Password reset failed.") },
      { status: 400 }
    );
  }
}
