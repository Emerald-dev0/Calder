import { getDb } from "@calder/db";
import { getConfig } from "@calder/config";
import { isOptionalCategory, setCategoryDisabled, verifyPreferenceToken } from "@calder/notify";

/**
 * Opt-out endpoint for Calder's own optional mail.
 *
 * Two shapes, because two things link here:
 *  - a person clicking "Manage what you receive" in a footer → GET, which must
 *    NOT change anything (mailbox scanners follow links; a GET that opts
 *    somebody out silently is a bug, not a feature) and returns a confirm page;
 *  - a mailbox provider doing RFC 8058 one-click → POST with the token, applied
 *    without further confirmation.
 *
 * The token names one user and one category. It cannot enable anything, cannot
 * touch mandatory mail, and is useless for any other address.
 */

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  updates: "Product news and announcements",
  digest: "The monthly workspace recap",
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Calder</title></head>
<body style="margin:0;background:#F5F4EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B0C0E;">
<main style="max-width:520px;margin:0 auto;padding:64px 24px;">
  <div style="background:#fff;border:1px solid #E5E5E5;border-radius:16px;padding:40px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#737373;margin:0 0 24px;">Calder</div>
    <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;">${title}</h1>
    ${body}
  </div>
  <p style="text-align:center;font-size:12px;color:#737373;margin:24px 0 0;">
    Calder · <a href="https://calder.click" style="color:#737373;">calder.click</a>
  </p>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

interface Applied {
  ok: boolean;
  category?: string;
  reason?: string;
}

async function applyToken(token: string | null): Promise<Applied> {
  if (!token) return { ok: false, reason: "missing_token" };
  const parsed = verifyPreferenceToken(token);
  if (!parsed) return { ok: false, reason: "invalid_token" };
  if (!isOptionalCategory(parsed.category)) return { ok: false, reason: "mandatory_category" };
  const result = await setCategoryDisabled(getDb(), parsed.userId, parsed.category, true);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, category: parsed.category };
}

/** One-click (RFC 8058). Mailbox providers POST here with no user in the loop. */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const applied = await applyToken(url.searchParams.get("token"));
  if (!applied.ok) {
    return new Response("unsubscribe_failed", {
      status: applied.reason === "invalid_token" ? 400 : 200,
      headers: { "content-type": "text/plain", "cache-control": "no-store" },
    });
  }
  return new Response("unsubscribed", {
    status: 200,
    headers: { "content-type": "text/plain", "cache-control": "no-store" },
  });
}

/** Human path: show what will change, with a button. Mutates nothing. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const parsed = token ? verifyPreferenceToken(token) : null;

  if (!parsed || !isOptionalCategory(parsed.category)) {
    return page(
      "That link has expired",
      `<p style="font-size:15px;line-height:1.6;color:#404040;margin:0 0 20px;">
         This unsubscribe link is not valid. You can change every email preference from your account settings instead.
       </p>
       <a href="${getConfig().APP_URL.replace(/\/$/, "")}/settings/notifications"
          style="display:inline-block;padding:12px 22px;border-radius:999px;background:#1E3A8A;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">
         Open email settings
       </a>`,
      400
    );
  }

  const label = CATEGORY_LABEL[parsed.category] ?? parsed.category;
  return page(
    `Stop receiving ${label.toLowerCase()}?`,
    `<p style="font-size:15px;line-height:1.6;color:#404040;margin:0 0 8px;">
       Clicking the button below turns off <strong>${label}</strong> for your Calder account.
     </p>
     <p style="font-size:14px;line-height:1.6;color:#737373;margin:0 0 24px;">
       Account, billing, security and service notices are not affected — those are the emails that tell you
       something happened to your account, and we cannot switch them off.
     </p>
     <form method="post" action="/api/unsubscribe/company?token=${encodeURIComponent(token ?? "")}">
       <button type="submit"
         style="padding:12px 22px;border-radius:999px;border:0;background:#1E3A8A;color:#fff;font-weight:600;font-size:14px;cursor:pointer;">
         Unsubscribe from ${label.toLowerCase()}
       </button>
     </form>`
  );
}
