import { getConfig } from "@calder/config";
import { MAGIC_LINK_FROM } from "@calder/auth";
import { brandEmail, createEmailService } from "@calder/email";
import { resolveEmailProvider } from "@calder/providers";
import { logger } from "@calder/observability";

export type SecurityEmailEvent =
  "new_login" | "password_changed" | "password_reset" | "oauth_connected" | "oauth_disconnected";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

const COPY: Record<SecurityEmailEvent, { subject: string; heading: string; text: string }> = {
  new_login: {
    subject: "New sign-in to your Calder account",
    heading: "New sign-in",
    text: "A new sign-in to your Calder account was completed. If this was not you, reset your password and review your active sessions.",
  },
  password_changed: {
    subject: "Your Calder password was changed",
    heading: "Password changed",
    text: "Your Calder password was changed. If you did not make this change, reset your password immediately.",
  },
  password_reset: {
    subject: "Your Calder password was reset",
    heading: "Password reset",
    text: "Your Calder password was reset using a recovery code. If you did not request this, secure your account immediately.",
  },
  oauth_connected: {
    subject: "A sign-in method was added to Calder",
    heading: "Sign-in method added",
    text: "A new OAuth sign-in method was connected to your Calder account. If you did not do this, review your account and reset your password.",
  },
  oauth_disconnected: {
    subject: "A sign-in method was removed from Calder",
    heading: "Sign-in method removed",
    text: "An OAuth sign-in method was disconnected from your Calder account. If you did not do this, reset your password and review your active sessions.",
  },
};

/**
 * Customer-facing security notifications deliberately reuse the existing
 * auth email provider abstraction. Delivery failures are logged without
 * blocking the already-completed security operation; the event is still
 * recorded in the audit log by the caller.
 */
export async function sendSecurityEmail(opts: {
  to: string;
  event: SecurityEmailEvent;
  provider?: string;
}): Promise<void> {
  try {
    const config = getConfig();
    const status = resolveEmailProvider();
    const service = createEmailService(status.provider);
    const copy = COPY[opts.event];
    const detail = opts.provider ? ` Provider: ${opts.provider}.` : "";
    const text = `${copy.text}${detail}`;
    const html = brandEmail(
      `<h2 style="font-size:20px;font-weight:700;color:#0B0C0E;margin:0 0 12px;">${escapeHtml(copy.heading)}</h2>
       <p style="color:#404040;font-size:15px;line-height:1.5;margin:0 0 24px;">${escapeHtml(copy.text)}${escapeHtml(detail)}</p>
       <p style="color:#737373;font-size:13px;margin:0;">If you did not request this, sign in, change your password, and revoke sessions you do not recognize.</p>`,
      { preheader: copy.subject }
    );
    const result = await service.send({
      from: config.AUTH_EMAIL_FROM ?? MAGIC_LINK_FROM,
      to: opts.to,
      subject: copy.subject,
      html,
      text,
    });
    if (!result.accepted)
      logger.warn({ purpose: opts.event }, "Security notification was not accepted");
  } catch {
    // Provider exception text can contain destination/infrastructure details;
    // keep the security notification failure classification only.
    logger.warn({ purpose: opts.event }, "Security notification send failed");
  }
}
