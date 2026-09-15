import { Hono } from "hono";
import { z } from "zod";
import {
  getDb,
  waitlistSignups,
  waitlistConfirmation,
  suppressions,
  organizations,
  organizationMembers,
  subscriptions,
  plans,
} from "@calder/db";
import { logger } from "@calder/observability";
import { randomUUID } from "node:crypto";
import { signUnsubscribeToken } from "@calder/auth";
import { getConfig } from "@calder/config";
import { eq, and, desc, count as drizzleCount } from "drizzle-orm";
import type { Env } from "../app.js";
import { AppError, validationError } from "../errors/index.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { adminAuthMiddleware } from "../middleware/admin.js";
import { INTERNAL_PROJECT_ID } from "../services/email-service.js";
import { WAITLIST_UPDATE_001, renderCampaign } from "../campaigns/waitlist-update-001.js";
import { FOUNDER_INTRO } from "../campaigns/founder-intro.js";

const admin = new Hono<Env>();

const broadcastSchema = z.object({
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(1_000_000),
  text: z.string().min(1).max(1_000_000),
  campaign: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/, "Campaign key: lowercase, numbers, hyphens.")
    .optional(),
  from: z
    .string()
    .max(320)
    .regex(
      /^([^\s@]+@[^\s@]+\.[^\s@]+|sender_[A-Za-z0-9_-]{1,64})$/,
      "from must be email or sender_xxx"
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        filename: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[^/\\]+$/, "Filename cannot contain path separators"),
        contentType: z.string().max(127).optional(),
        contentBase64: z.string().min(1),
      })
    )
    .max(10)
    .optional(),
});

const CAMPAIGNS: Record<string, { subject: string; html: string; text: string; campaign: string }> =
  {
    [WAITLIST_UPDATE_001.campaign]: WAITLIST_UPDATE_001,
    [FOUNDER_INTRO.campaign]: FOUNDER_INTRO,
  };

/**
 * POST /v1/admin/waitlist/broadcast, send one campaign to the waitlist.
 * Admin-gated. Skips suppressed addresses. Every send carries a signed
 * one-click unsubscribe (RFC 8058) and a per-recipient idempotency key, so
 * re-running a campaign replays safely instead of doubling.
 */
admin.post(
  "/waitlist/broadcast",
  adminAuthMiddleware,
  rateLimitMiddleware("sending"),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) throw validationError("Invalid JSON body");

    // Named campaign (versioned content) or fully custom content.
    // Optional `from` overrides the sender; validated per-recipient send against
    // the project's authorized identities (default + connected Gmail addresses).
    let content: {
      subject: string;
      html: string;
      text: string;
      campaign: string;
      from?: string;
      attachments?: Array<{ filename: string; contentType?: string; contentBase64: string }>;
    } = {
      subject: "",
      html: "",
      text: "",
      campaign: "",
    };
    const rawFrom =
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).from === "string"
        ? ((body as Record<string, unknown>).from as string).trim()
        : undefined;
    if (rawFrom && !/^([^\s@]+@[^\s@]+\.[^\s@]+|sender_[A-Za-z0-9_-]{1,64})$/.test(rawFrom)) {
      throw new AppError("validation_error", "Invalid from: use email or sender_xxx.", 400);
    }
    // attachments from body (validated below via broadcastSchema)
    const rawAttachments =
      typeof body === "object" &&
      body !== null &&
      Array.isArray((body as Record<string, unknown>).attachments)
        ? ((body as Record<string, unknown>).attachments as Array<{
            filename: string;
            contentType?: string;
            contentBase64: string;
          }>)
        : undefined;
    if (rawAttachments) {
      const total = rawAttachments.reduce((n, a) => n + (a.contentBase64?.length ?? 0), 0);
      if (rawAttachments.length > 10)
        throw new AppError("validation_error", "At most 10 attachments.", 400);
      if (total > 25 * 1024 * 1024)
        throw new AppError("validation_error", "Attachments exceed 25 MB of base64 in total.", 400);
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "campaign" in body &&
      typeof (body as Record<string, unknown>).campaign === "string" &&
      !(body as Record<string, unknown>).subject
    ) {
      const named = CAMPAIGNS[(body as Record<string, string>).campaign as string];
      if (!named)
        throw new AppError(
          "validation_error",
          "Unknown campaign. Send subject/html/text for custom content.",
          400
        );
      content = { ...named, from: rawFrom, attachments: rawAttachments };
    } else {
      const parsed = broadcastSchema.safeParse(body);
      if (!parsed.success)
        throw validationError("subject, html, text required (or a known campaign key).");
      content = { ...parsed.data, campaign: parsed.data.campaign ?? `custom-${Date.now()}` };
    }

    let db;
    try {
      db = getDb();
    } catch {
      throw new AppError("internal_error", "Broadcast unavailable (database unreachable).", 503);
    }

    const signups = await db.select().from(waitlistSignups).limit(2000);
    const suppressed = new Set(
      (
        await db
          .select({ email: suppressions.email })
          .from(suppressions)
          .where(eq(suppressions.projectId, INTERNAL_PROJECT_ID))
      ).map((r) => r.email)
    );

    const { sendInternalEmail } = await import("../services/email-service.js");
    const apiBase = getConfig().API_URL.replace(/\/$/, "");
    const appBase = getConfig().APP_URL.replace(/\/$/, "");
    let queued = 0;
    let skipped = 0;
    const failures: Array<{ email: string; error: string }> = [];

    for (const s of signups) {
      if (suppressed.has(s.email)) {
        skipped++;
        continue;
      }
      const ahead = signups.filter((o) => o.createdAt <= s.createdAt).length;
      const token = signUnsubscribeToken(INTERNAL_PROJECT_ID, s.email);
      const rendered = renderCampaign(content, {
        email: s.email,
        position: ahead,
        referral_code: s.referralCode,
        referral_link: `${appBase}/waitlist?ref=${s.referralCode}`,
      });
      const unsubUrl = `${apiBase}/v1/unsubscribe?token=${token}`;
      try {
        await sendInternalEmail({
          to: s.email,
          from: content.from,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          attachments: content.attachments,
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          idempotencyKey: `broadcast:${content.campaign}:${s.email}`,
          requestId: c.get("requestId"),
        });
        queued++;
      } catch (err) {
        failures.push({ email: s.email, error: err instanceof Error ? err.message : "unknown" });
      }
    }

    return c.json(
      { data: { campaign: content.campaign, queued, skipped_suppressed: skipped, failures } },
      202
    );
  }
);

const subscriptionSchema = z.object({
  planTier: z.enum(["free", "starter", "pro", "scale"]),
  months: z.number().int().min(1).max(36).default(1),
});

/**
 * GET /v1/admin/organizations, every org with its active plan, period end,
 * and member count. Admin-gated. Sorted by newest first.
 */
admin.get("/organizations", adminAuthMiddleware, async (c) => {
  const db = getDb();
  const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
  const out = [];
  for (const org of orgs) {
    const [active] = await db
      .select({ planId: subscriptions.planId, periodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(and(eq(subscriptions.organizationId, org.id), eq(subscriptions.status, "active")))
      .limit(1);
    const [memberRow] = await db
      .select({ value: drizzleCount() })
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, org.id));
    const members = memberRow?.value ?? 0;
    out.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      members: members ?? 0,
      plan: active?.planId ?? null,
      periodEnd: active?.periodEnd ? new Date(active.periodEnd).toISOString() : null,
    });
  }
  return c.json({ data: out });
});

/**
 * POST /v1/admin/organizations/:orgId/subscription {planTier, months}.
 * Cancels any active subscription, opens a new one starting now.
 * Duration is explicit months, no hidden renewals, admin acts are logged.
 */
admin.post("/organizations/:orgId/subscription", adminAuthMiddleware, async (c) => {
  const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    throw validationError("planTier (free|starter|pro|scale) and months (1-36) required.");
  const db = getDb();
  const orgId = c.req.param("orgId");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new AppError("not_found", "Organization not found.", 404);
  const [plan] = await db.select().from(plans).where(eq(plans.tier, parsed.data.planTier)).limit(1);
  if (!plan) throw new AppError("not_found", "Plan tier not seeded. Run db:seed.", 404);
  await db
    .update(subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")));
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + parsed.data.months);
  const id = `sub_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  await db.insert(subscriptions).values({
    id,
    organizationId: orgId,
    planId: plan.id,
    status: "active",
    currentPeriodStart: start,
    currentPeriodEnd: end,
  });
  logger.info({ orgId, plan: plan.tier, months: parsed.data.months }, "Admin set subscription");
  return c.json(
    { data: { id, organizationId: orgId, plan: plan.tier, periodEnd: end.toISOString() } },
    201
  );
});

/**
 * GET /v1/admin/waitlist/confirmation — fetch the dynamic waitlist confirmation template.
 * Admin-gated. Falls back to defaults if no row exists.
 */
admin.get("/waitlist/confirmation", adminAuthMiddleware, async (c) => {
  const db = getDb();
  const [row] = await db
    .select()
    .from(waitlistConfirmation)
    .where(eq(waitlistConfirmation.id, "internal"))
    .limit(1);
  if (!row) {
    // Falls back to the shipped default copy ({{first_name}} renders per recipient).
    return c.json({
      data: {
        subject: "You're in. Welcome to Calder.",
        html: "<p>Hi {{first_name}},</p><p>You're officially on the Calder waitlist. 🎉</p><p>Honestly, thank you for joining us this early.</p><p>We have a lot to build, and we can't wait to show you what's coming.</p><p>— The Calder Team<br>Communication infrastructure for modern applications.</p>",
        text: "Hi {{first_name}},\n\nYou're officially on the Calder waitlist. 🎉\n\nHonestly, thank you for joining us this early.\n\nWe have a lot to build, and we can't wait to show you what's coming.\n\n— The Calder Team\nCommunication infrastructure for modern applications.",
        updatedAt: null,
      },
    });
  }
  return c.json({ data: row });
});

/**
 * PUT /v1/admin/waitlist/confirmation {subject, html, text} — upsert the confirmation template.
 * Admin-gated. Dynamic so the founder can change the waitlist welcome without a deploy.
 */
admin.put("/waitlist/confirmation", adminAuthMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z
    .object({
      subject: z.string().min(1).max(998),
      html: z.string().min(1).max(1_000_000),
      text: z.string().min(1).max(1_000_000),
    })
    .safeParse(body);
  if (!parsed.success) throw validationError("subject, html, text required.");
  const db = getDb();
  const now = new Date();
  await db
    .insert(waitlistConfirmation)
    .values({
      id: "internal",
      subject: parsed.data.subject,
      html: parsed.data.html,
      text: parsed.data.text,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: waitlistConfirmation.id,
      set: {
        subject: parsed.data.subject,
        html: parsed.data.html,
        text: parsed.data.text,
        updatedAt: now,
      },
    });
  return c.json({ data: { ok: true, updatedAt: now.toISOString() } });
});

export default admin;
