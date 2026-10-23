import { getDb } from "@calder/db";
import { sendCompanyEmailQuietly } from "@calder/notify";

/**
 * One-time codes: signup verification and password reset.
 *
 * These are the two emails where failure is terminal for the user — no code,
 * no account, no way back in — so they go through the same delivery path as
 * every other company email, which records the attempt in `company_emails`
 * and warns when no real provider is configured. A silent mock in production
 * is the failure mode this is written to make visible.
 */
export async function sendOtpEmail(opts: {
  to: string;
  code: string;
  purpose: "verification" | "reset";
  userId?: string | null;
}): Promise<void> {
  const isVerification = opts.purpose === "verification";

  await sendCompanyEmailQuietly(getDb(), {
    id: isVerification ? "account.verification_code" : "account.password_reset_code",
    to: opts.to,
    userId: opts.userId ?? null,
    // Keyed on the code, not the challenge: a resend issues a new code and MUST
    // produce a new email, while a retried request for the same code must not.
    idempotencyKey: `otp:${opts.purpose}:${opts.to.toLowerCase()}:${opts.code}`,
    data: { code: opts.code, expiresInMinutes: 10 },
  });
}
