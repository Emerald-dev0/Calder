import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users } from "@calder/db";
import {
  issueEmailCode,
  normalizeEmail,
  isPlausibleEmail,
  type EmailCodePurpose,
} from "@calder/auth";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";
import { clientIp } from "../../../../lib/client-ip";
import { sendOtpEmail } from "../../../../lib/send-auth-email";

/**
 * POST /api/auth/email-code { email, purpose }
 * Reissue a 6-digit OTP code for verification or password reset.
 * Always returns ok where enumeration matters.
 * Rate-limited per IP (otp) and per email (otp).
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    email?: string;
    purpose?: EmailCodePurpose;
  } | null;

  const email = normalizeEmail(String(body?.email ?? ""));
  const purpose: EmailCodePurpose = body?.purpose === "reset" ? "reset" : "verification";

  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: "Provide a valid email address." }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const ipKey = `email-code:ip:${clientIp(req)}`;
  const emailKey = `email-code:email:${email}`;

  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.otp),
    limiter.check(emailKey, rateLimitPresets.otp),
  ]);

  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many code requests. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    if (purpose === "reset") {
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      // If user doesn't exist or has no password hash, do not issue reset code, but return ok
      if (!user || !user.passwordHash) {
        logger.info({ email }, "Password reset requested for nonexistent or passwordless user");
        return NextResponse.json({ ok: true });
      }
    }

    const challenge = await issueEmailCode(email, purpose);
    await sendOtpEmail({
      to: email,
      code: challenge.code,
      purpose,
    });
  } catch (err) {
    logger.warn({ err, email, purpose }, "Failed to issue email OTP code");
  }

  return NextResponse.json({ ok: true });
}
