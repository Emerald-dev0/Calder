import { Hono } from "hono";
import { getDb, projects } from "@calder/db";
import { verifyUnsubscribeToken } from "@calder/auth";
import { eq } from "drizzle-orm";
import type { Env } from "../app.js";
import { AppError, validationError } from "../errors/index.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { recordResubscribe, recordUnsubscribe } from "@calder/audiences";

const unsubscribe = new Hono<Env>();

function confirmationPage(message: string, undoToken?: string): string {
  const undo = undoToken
    ? `<form method="post" action="/v1/unsubscribe/resubscribe" style="margin-top:1.25rem">
         <input type="hidden" name="token" value="${undoToken.replace(/"/g, "&quot;")}">
         <button type="submit" style="font:inherit;font-size:.875rem;background:none;border:1px solid #D4D4D4;border-radius:999px;padding:.5rem 1rem;cursor:pointer;color:#0B0C0E">
           Changed your mind? Resubscribe
         </button>
       </form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribed, Calder</title></head><body style="font-family:system-ui, -apple-system, sans-serif;background:#F5F4EF;color:#0B0C0E;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0"><main style="text-align:center;max-width:26rem;padding:2rem"><h1 style="font-size:1.5rem;margin:0 0 .5rem">Done.</h1><p style="color:#52525b;line-height:1.6;margin:0">${message}</p>${undo}</main></body></html>`;
}

/** Resolve the workspace that owns a project, for the consent event row. */
async function organizationFor(projectId: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/**
 * GET, the footer link a person clicks.
 *
 * Idempotent by construction: the consent service treats a second request as
 * "already", and the page says so instead of pretending it did something new.
 * Unsubscribing from a link is deliberately workspace-scoped — a person who
 * clicks "unsubscribe" in a newsletter means "stop emailing me", not "remove
 * me from this one list and keep the rest coming".
 */
unsubscribe.get("/", rateLimitMiddleware("otp"), async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) throw validationError("Missing unsubscribe token.");
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new AppError("validation_error", "This unsubscribe link is invalid.", 400);

  let organizationId: string | null = null;
  try {
    organizationId = await organizationFor(parsed.projectId);
  } catch {
    throw new AppError("internal_error", "Unsubscribe is temporarily unavailable.", 503);
  }
  if (!organizationId) {
    // The project is gone; the address should still stop receiving mail if a
    // suppression can be written, but there is no history to attach it to.
    throw new AppError("not_found", "This unsubscribe link is no longer active.", 404);
  }

  const { already } = await recordUnsubscribe(
    getDb(),
    {
      projectId: parsed.projectId,
      organizationId,
      email: parsed.email,
      userAgent: c.req.header("user-agent") ?? null,
    },
    { source: "link_click", scope: "workspace" }
  );

  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.html(
    confirmationPage(
      already
        ? "You were already unsubscribed. Nothing else will arrive."
        : "You will not receive marketing email from this workspace again. Receipts, password resets and other account mail still arrive, because those are not marketing.",
      already ? undefined : token
    )
  );
});

/**
 * POST, RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`).
 *
 * Mailbox providers call this with no user in the loop, so it must be fast,
 * idempotent, and it must never require a session.
 */
unsubscribe.post("/", rateLimitMiddleware("otp"), async (c) => {
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const token =
    typeof body === "object" && body !== null && "token" in body
      ? String((body as Record<string, unknown>).token ?? "")
      : (c.req.query("token") ?? "");
  if (!token) throw validationError("Missing unsubscribe token.");
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new AppError("validation_error", "This unsubscribe link is invalid.", 400);

  const organizationId = await organizationFor(parsed.projectId);
  if (!organizationId)
    throw new AppError("not_found", "This unsubscribe link is no longer active.", 404);

  await recordUnsubscribe(
    getDb(),
    {
      projectId: parsed.projectId,
      organizationId,
      email: parsed.email,
      userAgent: c.req.header("user-agent") ?? null,
    },
    { source: "one_click_header", scope: "workspace" }
  );
  return c.json({ data: { unsubscribed: true } });
});

/** The undo path. Only ever reachable from a deliberate POST. */
unsubscribe.post("/resubscribe", rateLimitMiddleware("otp"), async (c) => {
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const token = String((body as Record<string, unknown>).token ?? c.req.query("token") ?? "");
  if (!token) throw validationError("Missing token.");
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) throw new AppError("validation_error", "This link is invalid.", 400);

  const organizationId = await organizationFor(parsed.projectId);
  if (!organizationId) throw new AppError("not_found", "This link is no longer active.", 404);

  await recordResubscribe(
    getDb(),
    {
      projectId: parsed.projectId,
      organizationId,
      email: parsed.email,
      userAgent: c.req.header("user-agent") ?? null,
    },
    { source: "unsubscribe_page", scope: "workspace" }
  );

  // A bounce or complaint row is a fact about the mailbox and is not cleared
  // by this call; saying "you're back" when we still cannot deliver would be
  // a lie, so the copy acknowledges both cases.
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.html(
    confirmationPage(
      "You are subscribed again. If this address previously hard-bounced or was marked as spam, delivery may still fail until that clears. Account, billing and security mail was never affected."
    )
  );
});

export default unsubscribe;
