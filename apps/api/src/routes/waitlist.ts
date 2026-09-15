import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { getDb, waitlistSignups } from "@calder/db";
import { getConfig } from "@calder/config";
import { INTERNAL_PROJECT_ID } from "../services/email-service.js";
import { joinWaitlistSchema } from "@calder/validation";
import { eq, lte, count } from "drizzle-orm";
import type { Env } from "../app.js";
import { AppError, validationError } from "../errors/index.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { kickDrain, executionCtxOf } from "../lib/kick-drain.js";

const waitlist = new Hono<Env>();

/** Unambiguous alphabet, no 0/O, 1/l confusion on a ticket. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateReferralCode(length = 8): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomInt(46656).toString(36).padStart(3, "0")}`;
}

async function referralCodeExists(db: ReturnType<typeof getDb>, code: string): Promise<boolean> {
  const rows = await db
    .select({ id: waitlistSignups.id })
    .from(waitlistSignups)
    .where(eq(waitlistSignups.referralCode, code))
    .limit(1);
  return rows.length > 0;
}

async function uniqueReferralCode(db: ReturnType<typeof getDb>): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    if (!(await referralCodeExists(db, code))) return code;
  }
  throw new AppError("internal_error", "Could not generate a referral code. Please retry.", 500);
}

interface Ticket {
  email: string;
  position: number;
  total: number;
  referrals: number;
  referralCode: string;
  createdAt: string;
}

async function buildTicket(db: ReturnType<typeof getDb>, email: string): Promise<Ticket | null> {
  const rows = await db
    .select()
    .from(waitlistSignups)
    .where(eq(waitlistSignups.email, email))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const totalRows = await db.select({ value: count() }).from(waitlistSignups);
  const aheadRows = await db
    .select({ value: count() })
    .from(waitlistSignups)
    .where(lte(waitlistSignups.createdAt, row.createdAt));
  const referralRows = await db
    .select({ value: count() })
    .from(waitlistSignups)
    .where(eq(waitlistSignups.referredBy, row.referralCode));
  const total = totalRows[0]?.value ?? 0;
  const ahead = aheadRows[0]?.value ?? 0;
  const referrals = referralRows[0]?.value ?? 0;

  return {
    email: row.email,
    position: ahead,
    total,
    referrals,
    referralCode: row.referralCode,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Default confirmation copy, used when no dynamic template row exists.
 * `firstName` is already defaulted by the caller (null → "there").
 * Matches the frontend success state and the hosted flyer at /calder-flyer.png
 * (also attached as Calder-admission.png). Uses table layout + inline styles
 * for email clients.
 */
function DEFAULT_CONFIRMATION_HTML(firstName: string): string {
  const safe = escapeHtml(firstName);
  return [
    `<!doctype html>`,
    `<html><body style="margin:0; padding:0; background:#F5F4EF;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F4EF; padding:32px 16px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#FFFFFF; border:1px solid #E5E5E5; border-radius:12px; overflow:hidden;">`,
    `<tr><td style="padding:32px 32px 0; text-align:center;">`,
    `<p style="margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:#737373;">YOU&apos;RE IN &middot; CALDER</p>`,
    `</td></tr>`,
    `<tr><td style="padding:24px 32px 0;">`,
    `<img src="https://calder.click/calder-flyer.png" alt="Calder admission — Admission confirmed" width="496" style="width:100%; max-width:496px; height:auto; display:block; border-radius:8px; border:1px solid #E5E5E5; margin:0 auto;" />`,
    `</td></tr>`,
    `<tr><td style="padding:24px 32px;">`,
    `<h1 style="margin:0 0 16px; font-family:Georgia,serif; font-size:24px; line-height:1.25; color:#0B0C0E; font-weight:700;">Welcome aboard, ${safe}.</h1>`,
    `<p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">You&apos;re officially on the <strong style="font-weight:600;">Calder list</strong>.</p>`,
    `<p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">We&apos;re building something we&apos;re genuinely excited about, and you&apos;ll be <strong>hearing from us as it takes shape</strong>.</p>`,
    `<p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">Over the coming days and weeks, our founder and the Calder team may drop into your inbox with <strong>product updates</strong>, things we&apos;re working on, and a few <strong>behind-the-scenes looks</strong> at what&apos;s coming.</p>`,
    `<p style="margin:0 0 16px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">Thanks for getting here early.</p>`,
    `<p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">We&apos;ll see you around.</p>`,
    `<p style="margin:24px 0 0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:15px; line-height:1.6; color:#0B0C0E;">&mdash; <strong>The Calder Team</strong><br><span style="color:#737373; font-size:13px;">Communication infrastructure for applications.</span></p>`,
    `</td></tr>`,
    `<tr><td style="padding:0 32px 32px; text-align:center;">`,
    `<p style="margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:12px; color:#737373;">Your ticket is attached as <strong>Calder-admission.png</strong>. You can also <a href="https://calder.click/calder-flyer.png" style="color:#0B0C0E; text-decoration:underline;">download it here</a>.</p>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr></table>`,
    `</body></html>`,
  ].join("");
}

function DEFAULT_CONFIRMATION_TEXT(firstName: string): string {
  return [
    `YOU'RE IN · CALDER`,
    ``,
    `Welcome aboard, ${firstName}.`,
    ``,
    `You're officially on the Calder list.`,
    ``,
    `We're building something we're genuinely excited about, and you'll be hearing from us as it takes shape.`,
    ``,
    `Over the coming days and weeks, our founder and the Calder team may drop into your inbox with product updates, things we're working on, and a few behind-the-scenes looks at what's coming.`,
    ``,
    `Thanks for getting here early.`,
    ``,
    `We'll see you around.`,
    ``,
    `-- The Calder Team`,
    `Communication infrastructure for applications.`,
    ``,
    `Your ticket is attached as Calder-admission.png. Download: https://calder.click/calder-flyer.png`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// POST /v1/waitlist, join (or re-fetch your ticket if already joined)
waitlist.post("/", rateLimitMiddleware("waitlist"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = joinWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("validation_error", "That email doesn't look valid.", 400);
  }
  const { email, ref } = parsed.data;
  const firstName = parsed.data.first_name ?? null;

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    throw new AppError(
      "internal_error",
      "The waitlist is temporarily unavailable. Please try again in a minute.",
      503
    );
  }

  // Already joined → return the existing ticket (idempotent by email).
  // If they re-submitted with a first name we don't have yet, capture it.
  const existing = await buildTicket(db, email);
  if (existing) {
    if (firstName) {
      const [row] = await db
        .select({ firstName: waitlistSignups.firstName })
        .from(waitlistSignups)
        .where(eq(waitlistSignups.email, email))
        .limit(1);
      if (row && !row.firstName) {
        await db.update(waitlistSignups).set({ firstName }).where(eq(waitlistSignups.email, email));
      }
    }
    return c.json({ data: { ...existing, joined: false } }, 200);
  }

  // Validate referral code if provided (unknown codes are ignored, not errors).
  let referredBy: string | null = null;
  if (ref && (await referralCodeExists(db, ref))) referredBy = ref;

  const code = await uniqueReferralCode(db);
  // Set createdAt explicitly (ms precision) instead of DB now(): Postgres stores
  // microseconds, but the driver round-trips milliseconds, comparing a re-read
  // timestamp against stored values then misses by fractions of a millisecond
  // (position computed as 0). Exact-ms values compare exactly.
  const now = new Date();
  try {
    await db.insert(waitlistSignups).values({
      id: newId("wl"),
      email,
      firstName,
      referralCode: code,
      referredBy,
      createdAt: now,
    });
  } catch (err: unknown) {
    // Race: same email inserted concurrently → return the winner's ticket.
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      const winner = await buildTicket(db, email);
      if (winner) return c.json({ data: { ...winner, joined: false } }, 200);
    }
    console.error(`[waitlist-insert] ${err instanceof Error ? err.message : String(err)}`, err);
    throw new AppError("internal_error", "Could not join the waitlist. Please retry.", 500);
  }

  const ticket = await buildTicket(db, email);
  if (!ticket)
    throw new AppError("internal_error", "Could not join the waitlist. Please retry.", 500);

  // Dogfood: confirm through our own pipeline under the founder-owned tenant.
  // Same idempotency key every time, so replays never duplicate. A failure here
  // must never fail the signup, log loudly, deliverability is retried by design.
  // Dynamic template: admin can change via PUT /v1/admin/waitlist/confirmation without a deploy.
  try {
    const { sendInternalEmail } = await import("../services/email-service.js");
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const { signUnsubscribeToken: signToken } = await import("@calder/auth");
    const confirmUnsub = `${getConfig().API_URL.replace(/\/$/, "")}/v1/unsubscribe?token=${signToken(INTERNAL_PROJECT_ID, email)}`;
    let subject = `You're in. Welcome to Calder.`;
    let html = DEFAULT_CONFIRMATION_HTML(firstName ?? "there");
    let text = DEFAULT_CONFIRMATION_TEXT(firstName ?? "there");
    try {
      const { getDb, waitlistConfirmation } = await import("@calder/db");
      const { eq } = await import("drizzle-orm");
      const d = getDb();
      const [tpl] = await d
        .select()
        .from(waitlistConfirmation)
        .where(eq(waitlistConfirmation.id, "internal"))
        .limit(1);
      if (tpl) {
        subject = tpl.subject;
        html = tpl.html;
        text = tpl.text;
      }
    } catch {
      // fallback to hardcoded
    }
    // Mustache rendering for the waitlist confirmation. {{first_name}} is
    // HTML-escaped in the html body; email/referral values are ours or
    // already constrained, so they pass through.
    const ticketRef = ticket.referralCode;
    const render = (s: string, escape: (v: string) => string) =>
      s
        .replace(/\{\{first_name\}\}/g, escape(firstName ?? "there"))
        .replace(/\{\{email\}\}/g, email)
        .replace(/\{\{referral_link\}\}/g, `${appUrl}/waitlist?ref=${ticketRef}`)
        .replace(/\{\{referral_code\}\}/g, ticketRef);
    const { FLYER_BASE64, FLYER_FILENAME, FLYER_CONTENT_TYPE } = await import("../assets/flyer.js");
    await sendInternalEmail({
      to: email,
      subject: render(subject, (v) => v),
      unsubscribeUrl: confirmUnsub,
      html: render(html, escapeHtml),
      text: render(text, (v) => v),
      idempotencyKey: `waitlist-confirm:${email}`,
      requestId: c.get("requestId"),
      attachments: [
        {
          filename: FLYER_FILENAME,
          contentType: FLYER_CONTENT_TYPE,
          contentBase64: FLYER_BASE64,
        },
      ],
    });
  } catch (err) {
    const { logger } = await import("@calder/observability");
    logger.error({ err, email }, "Waitlist confirmation failed to enqueue (signup kept)");
  }

  // The confirmation was just enqueued; let it leave now.
  kickDrain(executionCtxOf(c));

  return c.json({ data: { ...ticket, joined: true } }, 201);
});

// GET /v1/waitlist/position?email=, returning visitor ticket lookup
waitlist.get("/position", rateLimitMiddleware("waitlist"), async (c) => {
  const email = (c.req.query("email") ?? "").toLowerCase().trim();
  if (!email || !email.includes("@")) throw validationError("Provide a valid ?email= address.");
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    throw new AppError("internal_error", "The waitlist is temporarily unavailable.", 503);
  }
  const ticket = await buildTicket(db, email);
  if (!ticket) throw new AppError("not_found", "That email isn't on the list yet.", 404);
  return c.json({ data: { ...ticket, joined: false } });
});

// GET /v1/waitlist/count, public total for the landing page
waitlist.get("/count", rateLimitMiddleware("waitlist"), async (c) => {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch {
    return c.json({ data: { total: 0, unavailable: true } });
  }
  const totalRows = await db.select({ value: count() }).from(waitlistSignups);
  const total = totalRows[0]?.value ?? 0;
  return c.json({ data: { total } });
});

export default waitlist;
