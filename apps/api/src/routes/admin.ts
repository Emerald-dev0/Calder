import { Hono } from "hono";
import { z } from "zod";
import { getDb, waitlistSignups, suppressions } from "@calder/db";
import { signUnsubscribeToken } from "@calder/auth";
import { getConfig } from "@calder/config";
import { eq } from "drizzle-orm";
import type { Env } from "../app";
import { AppError, validationError } from "../errors/index";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { adminAuthMiddleware } from "../middleware/admin";
import { INTERNAL_PROJECT_ID } from "../services/email-service";
import { WAITLIST_UPDATE_001, renderCampaign } from "../campaigns/waitlist-update-001";

const admin = new Hono<Env>();

const broadcastSchema = z.object({
  subject: z.string().min(1).max(998),
  html: z.string().min(1).max(1_000_000),
  text: z.string().min(1).max(1_000_000),
  campaign: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/, "Campaign key: lowercase, numbers, hyphens.")
    .optional(),
});

const CAMPAIGNS: Record<string, { subject: string; html: string; text: string; campaign: string }> =
  {
    [WAITLIST_UPDATE_001.campaign]: WAITLIST_UPDATE_001,
  };

/**
 * POST /v1/admin/waitlist/broadcast — send one campaign to the waitlist.
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
    let content = { subject: "", html: "", text: "", campaign: "" };
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
      content = named;
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

    const { sendInternalEmail } = await import("../services/email-service");
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
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
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

export default admin;
