import { getConfig } from "@calder/config";
import { MAGIC_LINK_FROM } from "@calder/auth";
import { brandEmail, createEmailService, MockEmailProvider } from "@calder/email";
import { logger } from "@calder/observability";

export async function sendOtpEmail(opts: {
  to: string;
  code: string;
  purpose: "verification" | "reset";
}): Promise<void> {
  const config = getConfig();
  const { createSesProvider } = await import("@calder/providers");
  const provider = config.AWS_ACCESS_KEY_ID
    ? createSesProvider(config.AWS_REGION)
    : new MockEmailProvider({ latencyMs: 50 });
  const service = createEmailService(provider);

  const isVerification = opts.purpose === "verification";
  const subject = isVerification
    ? `${opts.code} is your Calder verification code`
    : `${opts.code} is your Calder password reset code`;

  const heading = isVerification ? "Verify your email address" : "Reset your Calder password";

  const description = isVerification
    ? "Use the 6-digit code below to finish creating your account. It expires in 10 minutes."
    : "Use the 6-digit code below to set a new password. It expires in 10 minutes.";

  const html = brandEmail(
    `
    <h2 style="font-size: 20px; font-weight: 700; color: #0B0C0E; margin: 0 0 12px;">${heading}</h2>
    <p style="color: #404040; font-size: 15px; line-height: 1.5; margin: 0 0 24px;">${description}</p>
    <div style="background: #F5F4EF; border: 1px solid #E5E5E5; border-radius: 8px; padding: 18px 24px; text-align: center; margin: 0 0 24px;">
      <span style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0B0C0E;">${opts.code}</span>
    </div>
    <p style="color: #737373; font-size: 13px; margin: 0;">If you did not request this code, you can safely ignore this email. No action is required.</p>
    `,
    { preheader: subject }
  );

  const text = `${heading}\n\n${description}\n\nCode: ${opts.code}\n\nExpires in 10 minutes.\nIf you did not request this, ignore this email.`;

  try {
    const result = await service.send({
      from: MAGIC_LINK_FROM,
      to: opts.to,
      subject,
      html,
      text,
    });
    if (!result.accepted) {
      logger.warn({ to: opts.to, purpose: opts.purpose }, "Provider refused auth OTP send");
    }
  } catch (err) {
    logger.warn({ err, to: opts.to, purpose: opts.purpose }, "Failed to send auth OTP email");
  }
}
