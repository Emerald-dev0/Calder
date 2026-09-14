import { NextResponse } from "next/server";
import { getConfig } from "@calder/config";
import { requestMagicLink, normalizeEmail, isPlausibleEmail, MAGIC_LINK_FROM } from "@calder/auth";
import { brandEmail, createEmailService } from "@calder/email";
import { resolveEmailProvider } from "@calder/providers";
import { getRateLimiter, rateLimitPresets } from "@calder/rate-limit";
import { logger } from "@calder/observability";

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/**
 * POST /api/auth/magic-link { email } — email a one-time sign-in link.
 * Always returns ok (no account enumeration). Rate-limited per IP and per
 * email: 5/minute each, links are single-use with a 15-minute expiry.
 *
 * Sends synchronously via the provider abstraction, not the job queue: login
 * must not depend on worker liveness. Single transactional email, same
 * latency class as the OAuth code exchange. Bulk mail stays on the queue.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = normalizeEmail(String(body?.email ?? ""));
  if (!isPlausibleEmail(email)) {
    return NextResponse.json({ error: "Provide a valid email." }, { status: 400 });
  }

  const limiter = getRateLimiter();
  const ipKey = `magic-link:ip:${clientIp(req)}`;
  const emailKey = `magic-link:email:${email}`;
  const [byIp, byEmail] = await Promise.all([
    limiter.check(ipKey, rateLimitPresets.otp),
    limiter.check(emailKey, rateLimitPresets.otp),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Wait a minute and try again." },
      { status: 429 }
    );
  }

  try {
    const raw = await requestMagicLink(email);
    const origin = new URL(req.url).origin;
    const link = `${origin}/api/auth/magic-link/callback?token=${raw}`;
    const config = getConfig();
    const status = resolveEmailProvider();
    const service = createEmailService(status.provider);
    if (!status.deliverable) {
      logger.warn(
        { driver: status.driver, reason: status.reason },
        "Magic link is NOT deliverable"
      );
    }
    const html = brandEmail(
      `<p style="margin:0 0 16px;">Here is your one-time sign-in link. It expires in 15 minutes and works once.</p>
       <p style="margin:0 0 16px;"><a href="${link}" style="display:inline-block;background:#0B0C0E;color:#F5F4EF;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;">Sign in to Calder</a></p>
       <p style="margin:0;color:#737373;font-size:13px;">If you did not request this, ignore this email. Nothing will happen.</p>`,
      {
        preheader: "Your one-time Calder sign-in link.",
        unsubscribeReason: "You have a Calder account, so we email you about it.",
      }
    );
    const result = await service.send({
      from: config.AUTH_EMAIL_FROM ?? MAGIC_LINK_FROM,
      to: email,
      subject: "Sign in to Calder",
      html,
      text: `Sign in to Calder with this one-time link (expires in 15 minutes):\n\n${link}\n\nIf you did not request this, ignore this email.`,
    });
    if (!result.accepted) throw new Error("Provider refused the send.");
  } catch (err) {
    // Never enumerate: log the failure, still return ok. The user experience
    // is identical whether the address exists or sending hiccuped.
    logger.warn({ err, email }, "Magic-link request failed");
  }
  return NextResponse.json({ ok: true });
}
