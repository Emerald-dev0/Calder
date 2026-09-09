/**
 * Calder branded email wrapper. Every internal mail (waitlist confirmations,
 * campaigns, onboarding, billing) ships inside this layout: logo header,
 * content, footer with unsubscribe. Table-based for client compatibility,
 * inline styles only, no external CSS.
 */

export interface BrandOptions {
  /** Absolute URL of the logo asset. Defaults to the production brand mark. */
  logoUrl?: string;
  /** Plain-text unsubscribe URL. Rendered in the footer when provided. */
  unsubscribeUrl?: string;
  /** Preheader snippet shown in inbox previews. */
  preheader?: string;
}

const DEFAULT_LOGO = "https://calder.click/assets/brand/logo.svg";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function brandEmail(innerHtml: string, opts: BrandOptions = {}): string {
  const logoUrl = opts.logoUrl ?? DEFAULT_LOGO;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : "";
  const footerUnsub = opts.unsubscribeUrl
    ? `<p style="margin:12px 0 0;font-size:12px;color:#737373;"><a href="${opts.unsubscribeUrl}" style="color:#737373;text-decoration:underline;">Unsubscribe</a> · You received this because you joined the Calder waitlist.</p>`
    : `<p style="margin:12px 0 0;font-size:12px;color:#737373;">Transactional email from Calder infrastructure.</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background-color:#F5F4EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F4EF;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5E5E5;border-radius:12px;overflow:hidden;">
<tr><td style="padding:28px 32px 0;text-align:left;">
<img src="${logoUrl}" alt="Calder" width="120" style="display:block;border:0;" />
</td></tr>
<tr><td style="padding:20px 32px;font-size:15px;line-height:1.65;color:#0B0C0E;">
${innerHtml}
</td></tr>
<tr><td style="padding:0 32px 28px;border-top:1px solid #E5E5E5;">
${footerUnsub}
<p style="margin:8px 0 0;font-size:12px;color:#737373;">© Calder · Communication infrastructure that gets out of your way.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
