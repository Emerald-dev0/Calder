import { NextResponse } from "next/server";
import { getConfig } from "@calder/config";
import { requestMagicLink, normalizeEmail, isPlausibleEmail, MAGIC_LINK_FROM } from "@calder/auth";
import { brandEmail, createEmailService, MockEmailProvider } from "@calder/email";
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
    const { createSesProvider } = await import("@calder/providers");
    const provider = config.AWS_ACCESS_KEY_ID
      ? createSesProvider(config.AWS_REGION)
      : new MockEmailProvider({ latencyMs: 50 });
    const service = createEmailService(provider);
    const html = brandEmail(
      `<p>Click the link below to sign in to Calder. It expires in 15 minutes and works once.</p><p><a href="${link}">Sign in to Calder</a></p><p>If you did not request this, ignore this email.</p>`,
      { preheader: "Your one-time Calder sign-in link." }
    );
    const result = await service.send({
      from: MAGIC_LINK_FROM,
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
