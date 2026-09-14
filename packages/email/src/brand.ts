/**
 * Calder branded email wrapper. Every internal mail (waitlist confirmations,
 * verification codes, magic links, onboarding, billing) ships inside this
 * layout: logo header, content, footer with unsubscribe where one applies.
 *
 * Constraints, deliberately boring for client compatibility:
 * - table-based layout, no flex/grid
 * - inline styles only, no external CSS, no <style> block
 * - light and dark safe: background set on both body and the wrapper table
 * - single column at 600px, collapses to full width on phones
 */

export interface BrandOptions {
  /** Absolute URL of the logo asset. Defaults to the production brand mark. */
  logoUrl?: string;
  /** Plain-text unsubscribe URL. Rendered in the footer when provided. */
  unsubscribeUrl?: string;
  /** Why this email arrived. Defaults to a generic transactional reason. */
  unsubscribeReason?: string;
  /** Preheader snippet shown in inbox previews. */
  preheader?: string;
}

const DEFAULT_LOGO = "https://calder.click/assets/brand/logo.svg";
const DEFAULT_REASON = "You have a Calder account, so we email you about it.";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function brandEmail(innerHtml: string, opts: BrandOptions = {}): string {
  const logoUrl = opts.logoUrl ?? DEFAULT_LOGO;
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>`
    : "";
  const reason = opts.unsubscribeReason ?? DEFAULT_REASON;
  const footerUnsub = opts.unsubscribeUrl
    ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#737373;">${escapeHtml(reason)} <a href="${opts.unsubscribeUrl}" style="color:#3B82F6;text-decoration:none;font-weight:600;">Unsubscribe</a></p>`
    : `<p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#737373;">${escapeHtml(reason)}</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title></title>
  <style>
    @media screen and (max-width: 600px) {
      .content-cell { padding: 32px 24px !important; }
      .header-cell { padding: 32px 24px 0 !important; }
      .footer-cell { padding: 0 24px 32px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F5F4EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F4EF;padding:40px 16px;">
  <tr>
    <td align="center">
      <!--[if (gte mso 9)|(IE)]>
      <table align="center" border="0" cellspacing="0" cellpadding="0" width="600">
      <tr>
      <td align="center" valign="top" width="600">
      <![endif]-->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E5E5E5;border-radius:16px;overflow:hidden;box-shadow: 0 4px 12px rgba(11, 12, 14, 0.03);">
        <tr>
          <td class="header-cell" style="padding:40px 48px 0;text-align:left;">
            <a href="https://calder.click" style="text-decoration:none;">
              <img src="${logoUrl}" alt="Calder" width="128" style="display:block;border:0;width:128px;max-width:60%;height:auto;" />
            </a>
          </td>
        </tr>
        <tr>
          <td class="content-cell" style="padding:32px 48px 40px;font-size:16px;line-height:1.7;color:#0B0C0E;">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td class="footer-cell" style="padding:0 48px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E5E5E5;">
              <tr>
                <td style="padding-top:24px;">
                  ${footerUnsub}
                  <p style="margin:8px 0 0;font-size:12px;color:#737373;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                    Calder · <a href="https://calder.click" style="color:#737373;text-decoration:none;border-bottom:1px solid #D4D4D4;">calder.click</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!--[if (gte mso 9)|(IE)]>
      </td>
      </tr>
      </table>
      <![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
