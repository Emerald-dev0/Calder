import { Hono } from "hono";
import { getDb, suppressions } from "@calder/db";
import { verifyUnsubscribeToken } from "@calder/auth";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Env } from "../app";
import { AppError, validationError } from "../errors/index";
import { rateLimitMiddleware } from "../middleware/rate-limit";

const unsubscribe = new Hono<Env>();

async function suppress(projectId: string, email: string): Promise<{ already: boolean }> {
  const db = getDb();
  const existing = await db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(and(eq(suppressions.projectId, projectId), eq(suppressions.email, email)))
    .limit(1);
  if (existing[0]) return { already: true };
  await db.insert(suppressions).values({
    id: `sup_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    projectId,
    email,
    reason: "unsubscribe",
  });
  return { already: false };
}

function confirmationPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed — Calder</title></head><body style="font-family:system-ui,sans-serif;background:#F5F4EF;color:#0B0C0E;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><main style="text-align:center;max-width:24rem;padding:2rem"><h1 style="font-size:1.5rem">Done.</h1><p style="color:#52525b">${message}</p></main></body></html>`;
}

// GET — browser click from an email footer. Verifies, suppresses, confirms.
unsubscribe.get("/", rateLimitMiddleware("otp"), async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) throw validationError("Missing unsubscribe token.");
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new AppError("validation_error", "This unsubscribe link is invalid.", 400);
  try {
    getDb();
  } catch {
    throw new AppError("internal_error", "Unsubscribe is temporarily unavailable.", 503);
  }
  const { already } = await suppress(parsed.projectId, parsed.email);
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.html(
    confirmationPage(
      already
        ? "You were already unsubscribed — nothing else will arrive."
        : "Unsubscribed. You won't hear from this list again."
    )
  );
});

// POST — RFC 8058 one-click (List-Unsubscribe-Post: List-Unsubscribe=One-Click).
unsubscribe.post("/", rateLimitMiddleware("otp"), async (c) => {
  const body = await c.req.parseBody().catch(() => ({}));
  const token =
    typeof body === "object" && body !== null && "token" in body
      ? String((body as Record<string, unknown>).token ?? "")
      : (c.req.query("token") ?? "");
  if (!token) throw validationError("Missing unsubscribe token.");
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new AppError("validation_error", "This unsubscribe link is invalid.", 400);
  try {
    getDb();
  } catch {
    throw new AppError("internal_error", "Unsubscribe is temporarily unavailable.", 503);
  }
  await suppress(parsed.projectId, parsed.email);
  return c.json({ data: { unsubscribed: true } });
});

export default unsubscribe;
