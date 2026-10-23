/**
 * Building blocks for Calder's own email.
 *
 * Everything here produces inline-styled, table-safe HTML: no flexbox, no
 * grid, no external CSS. Email clients are the least capable renderers we
 * support and they get the plainest possible markup.
 *
 * Every interpolated string is escaped here, once. Templates therefore never
 * deal with HTML — they return plain text and this module decides how it looks.
 */

export type CalloutTone = "info" | "success" | "warning" | "danger";

const PALETTE = {
  ink: "#0B0C0E",
  body: "#404040",
  muted: "#737373",
  border: "#E5E5E5",
  paper: "#F5F4EF",
  surface: "#FFFFFF",
  accent: "#1E3A8A",
  link: "#1E3A8A",
  success: "#16A34A",
  warning: "#CA8A04",
  danger: "#DC2626",
} as const;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only absolute http(s) URLs may become a link. Anything else is dropped. */
export function safeUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:${PALETTE.ink};letter-spacing:-0.01em;">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${PALETTE.body};">${escapeHtml(text)}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(text)}</p>`;
}

export function detailsTable(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (row, i) => `<tr>
        <td style="padding:10px 0;border-top:${i === 0 ? "none" : `1px solid ${PALETTE.border}`};font-size:13px;color:${PALETTE.muted};width:42%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:10px 0;border-top:${i === 0 ? "none" : `1px solid ${PALETTE.border}`};font-size:13px;color:${PALETTE.ink};font-weight:600;vertical-align:top;word-break:break-word;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid ${PALETTE.border};border-radius:10px;border-collapse:separate;overflow:hidden;">
    <tr><td style="padding:2px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
  </table>`;
}

export function codeBlock(code: string, caption?: string): string {
  return `<div style="margin:0 0 20px;background:${PALETTE.paper};border:1px solid ${PALETTE.border};border-radius:10px;padding:18px 20px;text-align:center;">
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${PALETTE.ink};">${escapeHtml(code)}</div>
    ${caption ? `<div style="margin-top:8px;font-size:12px;color:${PALETTE.muted};">${escapeHtml(caption)}</div>` : ""}
  </div>`;
}

export function button(label: string, href: string): string {
  const url = safeUrl(href);
  if (!url) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="border-radius:999px;background:${PALETTE.accent};">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

export function callout(tone: CalloutTone, title: string | undefined, body: string): string {
  const color = {
    info: PALETTE.accent,
    success: PALETTE.success,
    warning: PALETTE.warning,
    danger: PALETTE.danger,
  }[tone];
  return `<div style="margin:0 0 20px;border-left:3px solid ${color};background:${PALETTE.paper};padding:12px 16px;border-radius:0 8px 8px 0;">
    ${title ? `<div style="font-size:13px;font-weight:700;color:${color};margin:0 0 4px;">${escapeHtml(title)}</div>` : ""}
    <div style="font-size:13px;line-height:1.6;color:${PALETTE.body};">${escapeHtml(body)}</div>
  </div>`;
}

export function divider(): string {
  return `<div style="height:1px;background:${PALETTE.border};margin:8px 0 20px;"></div>`;
}

export function linkLine(text: string, label: string, href: string): string {
  const url = safeUrl(href);
  if (!url) return paragraph(text);
  return `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(text)} <a href="${escapeHtml(url)}" style="color:${PALETTE.link};font-weight:600;text-decoration:underline;">${escapeHtml(label)}</a></p>`;
}
