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

// POST /v1/waitlist, join (or re-fetch your ticket if already joined)
waitlist.post("/", rateLimitMiddleware("waitlist"), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = joinWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("validation_error", "That email doesn't look valid.", 400);
  }
  const { email, ref } = parsed.data;

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
  const existing = await buildTicket(db, email);
  if (existing) return c.json({ data: { ...existing, joined: false } }, 200);

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
    let subject = `You're in, welcome to Calder early access`;
    let html = `<p>You're on the list, and this email proves our pipeline works end to end.</p><p>Over the coming weeks we'll send you updates as we build: Gmail Quickstart for junior developers, a CLI that explains itself, deliverability you can actually watch.</p><p>If this landed in spam, please move it to Primary so you don't miss out.</p><p>The Calder team<br><a href="${appUrl}/waitlist">calder.click</a></p>`;
    let text = `You're on the list, and this email proves our pipeline works end to end.\n\nOver the coming weeks we'll send updates as we build: Gmail Quickstart, a CLI that explains itself, deliverability you can watch.\n\nIf this landed in spam, please move it to Primary so you don't miss out.\n\nThe Calder team`;
    try {
      const { getDb, waitlistConfirmation } = await import("@calder/db");
      const { eq } = await import("drizzle-orm");
      const d = getDb();
      const [tpl] = await d.select().from(waitlistConfirmation).where(eq(waitlistConfirmation.id, "internal")).limit(1);
      if (tpl) {
        subject = tpl.subject;
        html = tpl.html;
        text = tpl.text;
      }
    } catch {
      // fallback to hardcoded
    }
    // Simple mustache for waitlist confirmation (position/referral not needed but supported)
    const ticketRef = ticket.referralCode;
    const render = (s: string) => s.replace(/\{\{email\}\}/g, email).replace(/\{\{referral_link\}\}/g, `${appUrl}/waitlist?ref=${ticketRef}`).replace(/\{\{referral_code\}\}/g, ticketRef);
    await sendInternalEmail({
      to: email,
      subject: render(subject),
      unsubscribeUrl: confirmUnsub,
      html: render(html),
      text: render(text),
      idempotencyKey: `waitlist-confirm:${email}`,
      requestId: c.get("requestId"),
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
