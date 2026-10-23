import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, users } from "@calder/db";
import { logger } from "@calder/observability";
import { sendCompanyEmailQuietly } from "@calder/notify";
import { verifyEmailChangeToken } from "../../../../../lib/email-change";

/**
 * GET /api/auth/email-change/confirm?token=…
 *
 * The link in the confirmation email. GET is correct here: the token is the
 * capability and it is single-use in practice (the account's address must still
 * match what it was issued for), so a mailbox scanner following the link would
 * complete the change the account owner asked for. That is why the token is
 * short-lived and bound to the *old* address.
 */
export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Calder</title></head>
<body style="margin:0;background:#F5F4EF;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#0B0C0E;">
<main style="max-width:520px;margin:0 auto;padding:64px 24px;">
  <div style="background:#fff;border:1px solid #E5E5E5;border-radius:16px;padding:40px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#737373;margin:0 0 24px;">Calder</div>
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;">${title}</h1>
    ${body}
  </div>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const verified = verifyEmailChangeToken(token);
  if (!verified.ok) {
    return page(
      verified.reason === "expired" ? "This link has expired" : "This link is not valid",
      `<p style="font-size:14px;color:#404040;margin:0 0 16px;">${
        verified.reason === "expired"
          ? "Confirmation links last one hour. Start the change again from Settings."
          : "The link is incomplete or was not issued by us."
      }</p><p style="font-size:14px;"><a href="/settings" style="color:#1E3A8A;">Open settings</a></p>`,
      verified.reason === "expired" ? 410 : 400
    );
  }

  const db = getDb();
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, verified.userId))
    .limit(1);

  if (!user || user.email.toLowerCase() !== verified.from) {
    return page(
      "This request is out of date",
      `<p style="font-size:14px;color:#404040;margin:0 0 16px;">The account's address changed after this link was issued, so it can no longer be used.</p>`,
      409
    );
  }

  const [conflict] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, verified.to))
    .limit(1);
  if (conflict) {
    return page(
      "That address is already in use",
      `<p style="font-size:14px;color:#404040;margin:0 0 16px;">Another Calder account owns ${verified.to}. Use a different address.</p>`,
      409
    );
  }

  await db
    .update(users)
    .set({ email: verified.to, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const notification = {
    id: "account.email_changed" as const,
    userId: user.id,
    data: { oldEmail: verified.from, newEmail: verified.to, when },
  };
  // The new address gets the receipt; the old address gets the alarm, because
  // after this moment it can no longer reach the account.
  await sendCompanyEmailQuietly(db, {
    ...notification,
    to: verified.to,
    idempotencyKey: `email-changed:new:${user.id}:${verified.to}`,
  });
  await sendCompanyEmailQuietly(db, {
    ...notification,
    to: verified.from,
    idempotencyKey: `email-changed:old:${user.id}:${verified.to}`,
  });

  try {
    const { recordSecurityEvent } = await import("@calder/auth");
    await recordSecurityEvent({ userId: user.id, action: "auth.email.changed" });
  } catch (err) {
    logger.warn({ err }, "Could not record email change security event");
  }

  return NextResponse.redirect(new URL("/settings?emailChange=done", req.url));
}
