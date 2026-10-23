import { Hono } from "hono";
import { getDb } from "@calder/db";
import { getConfig } from "@calder/config";
import type { Env } from "../app.js";
import { AppError, validationError } from "../errors/index.js";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import {
  broadcastReport,
  cancelBroadcast,
  createBroadcast,
  getBroadcast,
  listBroadcastRecipients,
  listBroadcasts,
  recordClick,
  sendBroadcast,
  sendBroadcastTest,
  updateBroadcast,
} from "../services/broadcast-service.js";

const broadcastsRoute = new Hono<Env>();

function auth(c: { get: (key: never) => unknown }): AuthContext {
  return c.get("auth" as never) as AuthContext;
}

function requireManage(c: { get: (key: never) => unknown }): AuthContext {
  const a = auth(c);
  requireScope(a, "manage");
  return a;
}

function environment(): "test" | "live" {
  return getConfig().NODE_ENV === "production" ? "live" : "test";
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

broadcastsRoute.get("/", authMiddleware, async (c) => {
  const a = auth(c);
  const data = await listBroadcasts(getDb(), a.projectId);
  return c.json({ data });
});

broadcastsRoute.post("/", authMiddleware, async (c) => {
  const a = requireManage(c);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = body as Record<string, unknown>;

  if (typeof parsed.name !== "string" || typeof parsed.subject !== "string") {
    throw validationError("`name` and `subject` are required.");
  }
  if (typeof parsed.senderId !== "string" || typeof parsed.audienceId !== "string") {
    throw validationError("`senderId` and `audienceId` are required.");
  }
  if (typeof parsed.html !== "string" || parsed.html.trim() === "") {
    throw validationError("`html` is required.");
  }

  const row = await createBroadcast(getDb(), {
    organizationId: a.organizationId,
    projectId: a.projectId,
    name: parsed.name,
    senderId: parsed.senderId,
    audienceId: parsed.audienceId,
    subject: parsed.subject,
    previewText: str(parsed.previewText) ?? null,
    html: parsed.html,
    text: str(parsed.text) ?? null,
    replyTo: str(parsed.replyTo) ?? null,
    scheduledAt: typeof parsed.scheduledAt === "string" ? new Date(parsed.scheduledAt) : null,
    timezone: str(parsed.timezone) ?? null,
    trackingClicks: parsed.trackingClicks !== false,
    createdBy: a.apiKeyId,
  });
  return c.json({ data: row }, 201);
});

broadcastsRoute.get("/:id", authMiddleware, async (c) => {
  const a = auth(c);
  const db = getDb();
  const row = await getBroadcast(db, a.projectId, c.req.param("id"));
  if (!row) throw new AppError("not_found", "Broadcast not found", 404);
  const report = await broadcastReport(db, row.id);
  const recipients = await listBroadcastRecipients(db, row.id, 100);
  return c.json({ data: { ...row, report, recipients } });
});

broadcastsRoute.patch("/:id", authMiddleware, async (c) => {
  const a = requireManage(c);
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = body as Record<string, unknown>;
  const row = await updateBroadcast(getDb(), a.projectId, c.req.param("id"), {
    ...(parsed.name !== undefined ? { name: String(parsed.name) } : {}),
    ...(parsed.subject !== undefined ? { subject: String(parsed.subject) } : {}),
    ...(parsed.previewText !== undefined ? { previewText: str(parsed.previewText) ?? null } : {}),
    ...(parsed.html !== undefined ? { html: String(parsed.html) } : {}),
    ...(parsed.text !== undefined ? { text: str(parsed.text) ?? null } : {}),
    ...(parsed.replyTo !== undefined ? { replyTo: str(parsed.replyTo) ?? null } : {}),
    ...(parsed.senderId !== undefined ? { senderId: String(parsed.senderId) } : {}),
    ...(parsed.audienceId !== undefined ? { audienceId: String(parsed.audienceId) } : {}),
    ...(parsed.scheduledAt !== undefined
      ? {
          scheduledAt: typeof parsed.scheduledAt === "string" ? new Date(parsed.scheduledAt) : null,
        }
      : {}),
  });
  return c.json({ data: row });
});

broadcastsRoute.post("/:id/send", authMiddleware, async (c) => {
  const a = requireManage(c);
  const result = await sendBroadcast(getDb(), {
    broadcastId: c.req.param("id"),
    projectId: a.projectId,
    organizationId: a.organizationId,
    env: environment(),
    requestId: `req_${a.apiKeyId}_${Date.now()}`,
  });
  return c.json({ data: result });
});

broadcastsRoute.post("/:id/test", authMiddleware, async (c) => {
  const a = requireManage(c);
  const body = await c.req.json().catch(() => null);
  const to = body ? str((body as Record<string, unknown>).to) : undefined;
  if (!to || !to.includes("@")) throw validationError("`to` must be an email address.");

  const result = await sendBroadcastTest(getDb(), {
    broadcastId: c.req.param("id"),
    projectId: a.projectId,
    organizationId: a.organizationId,
    env: environment(),
    requestId: `req_${a.apiKeyId}_${Date.now()}`,
    to,
  });
  return c.json({ data: result }, 202);
});

broadcastsRoute.post("/:id/cancel", authMiddleware, async (c) => {
  const a = requireManage(c);
  const cancelled = await cancelBroadcast(getDb(), a.projectId, c.req.param("id"));
  if (!cancelled) throw new AppError("not_found", "Broadcast not found", 404);
  return c.json({ data: { cancelled: true } });
});

/**
 * Public click redirect. No auth: the reader clicked a link in their inbox.
 * The token is unguessable, which is why the URL is safe to expose, and the
 * redirect never 302s to a URL the token did not already contain.
 */
broadcastsRoute.get("/click/:token", rateLimitMiddleware("beacon"), async (c) => {
  const token = c.req.param("token");
  if (!/^[a-zA-Z0-9]{8,64}$/.test(token)) throw new AppError("not_found", "Link not found", 404);
  const url = await recordClick(getDb(), token, {
    userAgent: c.req.header("user-agent") ?? null,
  });
  if (!url) throw new AppError("not_found", "Link not found", 404);
  return c.redirect(url, 302);
});

export default broadcastsRoute;
