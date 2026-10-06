import { Hono } from "hono";
import type { Env } from "../app.js";
import { createWebhookSchema, isPublicWebhookUrl } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";
import { logger } from "@calder/observability";
import { encryptSecret } from "@calder/auth";
import { WEBHOOK_SECRET_CONTEXT, newWebhookSecret } from "../lib/webhook-secrets.js";
import { decodeApiCursor, encodeApiCursor } from "../lib/pagination.js";

const webhooks = new Hono<Env>();

// POST /v1/webhooks — register an endpoint. The signing secret is returned
// EXACTLY ONCE here and stored ONLY AES-256-GCM encrypted (recoverable so the
// delivery engine can sign, never one-way hashed, never logged). There is no
// endpoint to read it back; losing it means rotating to a new secret via
// delete + re-create.
webhooks.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as AuthContext;
  requireScope(auth, "manage");
  const body = await c.req.json().catch(() => null);
  if (!body) throw new AppError("validation_error", "Invalid JSON", 400);
  const parsed = createWebhookSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid webhook", 400, parsed.error.flatten());
  if (!isPublicWebhookUrl(parsed.data.url)) {
    throw new AppError(
      "validation_error",
      "Endpoint URL refused: https, public internet only.",
      400,
      undefined,
      "Point Calder at your own public https endpoint. Local testing: use a tunnel or the dashboard create flow with localhost."
    );
  }

  const secret = newWebhookSecret();
  try {
    const { getDb, webhooks: webhooksTable } = await import("@calder/db");
    const { randomUUID } = await import("node:crypto");
    const db = getDb();
    const id = `wh_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await db.insert(webhooksTable).values({
      id,
      projectId: auth.projectId,
      url: parsed.data.url,
      secret: encryptSecret(secret, WEBHOOK_SECRET_CONTEXT),
      events: parsed.data.events,
    });
    return c.json({ data: { id, url: parsed.data.url, events: parsed.data.events, secret } }, 201);
  } catch (err) {
    // Fail closed: never fabricate a webhook id for a row that does not
    // exist. The secret must not leave this scope on failure either.
    logger.error({ err, projectId: auth.projectId }, "Failed to create webhook");
    throw new AppError("internal_error", "Could not create webhook.", 500);
  }
});

webhooks.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const { getDb, webhooks: webhooksTable } = await import("@calder/db");
  const { and, desc, eq, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 100);
  const cursor = c.req.query("cursor");
  const conditions = [eq(webhooksTable.projectId, auth.projectId)];
  const position = decodeApiCursor(cursor);
  if (position) {
    conditions.push(
      or(
        lt(webhooksTable.createdAt, position.createdAt),
        and(eq(webhooksTable.createdAt, position.createdAt), lt(webhooksTable.id, position.id))
      )!
    );
  }
  const rows = await db
    .select()
    .from(webhooksTable)
    .where(and(...conditions))
    .orderBy(desc(webhooksTable.createdAt), desc(webhooksTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  // Stored ciphertexts must never be exposed to clients.
  return c.json({
    data: page.map(({ secret: _secret, ...rest }) => rest),
    pagination: { limit, next_cursor: nextCursor },
  });
});

webhooks.delete("/:id", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as AuthContext;
  requireScope(auth, "manage");
  const id = c.req.param("id");
  const { getDb, webhooks: webhooksTable } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const deleted = await db
    .delete(webhooksTable)
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.projectId, auth.projectId)))
    .returning({ id: webhooksTable.id });
  if (deleted.length === 0) throw new AppError("not_found", "Webhook not found.", 404);
  return c.json({ data: { id, deleted: true } });
});

// POST /v1/webhooks/:id/rotate — new signing secret, shown ONCE, old secret
// stops signing immediately (single-secret contract; consumers must update
// before the next delivery, deliveries keep their historical signatures).
webhooks.post("/:id/rotate", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as AuthContext;
  requireScope(auth, "manage");
  const id = c.req.param("id");
  const { getDb, webhooks: webhooksTable } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const secret = newWebhookSecret();
  const updated = await db
    .update(webhooksTable)
    .set({ secret: encryptSecret(secret, WEBHOOK_SECRET_CONTEXT), updatedAt: new Date() })
    .where(and(eq(webhooksTable.id, id), eq(webhooksTable.projectId, auth.projectId)))
    .returning({ id: webhooksTable.id });
  if (updated.length === 0) throw new AppError("not_found", "Webhook not found.", 404);
  return c.json({ data: { id, secret } });
});

// GET /v1/webhooks/:id/deliveries — bounded cursor page, newest first.
webhooks.get("/:id/deliveries", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const id = c.req.param("id");
  const { getDb, webhookDeliveries } = await import("@calder/db");
  const { eq, and, desc, lt, or } = await import("drizzle-orm");
  const db = getDb();
  const limit = Math.min(Math.max(Number.parseInt(c.req.query("limit") ?? "25", 10) || 25, 1), 100);
  const position = decodeApiCursor(c.req.query("cursor"));
  const conditions = [
    eq(webhookDeliveries.webhookId, id),
    eq(webhookDeliveries.projectId, auth.projectId),
  ];
  if (position) {
    conditions.push(
      or(
        lt(webhookDeliveries.createdAt, position.createdAt),
        and(
          eq(webhookDeliveries.createdAt, position.createdAt),
          lt(webhookDeliveries.id, position.id)
        )
      )!
    );
  }
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attemptCount: webhookDeliveries.attemptCount,
      latencyMs: webhookDeliveries.latencyMs,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeApiCursor(last.createdAt, last.id) : null;
  return c.json({ data: page, pagination: { limit, next_cursor: nextCursor } });
});

// POST /v1/webhooks/:id/deliveries/:deliveryId/replay — explicit operator
// action: a NEW pending delivery with the SAME payload data, then queue it.
// Replays are never auto-deduped (the operator meant it); receivers dedupe
// on the business id inside data (e.g. emailId).
webhooks.post("/:id/deliveries/:deliveryId/replay", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as AuthContext;
  requireScope(auth, "manage");
  const id = c.req.param("id");
  const deliveryId = c.req.param("deliveryId");
  const { getDb, webhookDeliveries, enqueueWebhookDeliveries } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const db = getDb();
  const [src] = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.webhookId, id),
        eq(webhookDeliveries.projectId, auth.projectId)
      )
    )
    .limit(1);
  if (!src) throw new AppError("not_found", "Delivery not found.", 404);
  const data = (src.payload as { data?: Record<string, unknown> }).data ?? {};
  const created = await enqueueWebhookDeliveries(db, {
    projectId: auth.projectId,
    event: src.event,
    data,
    webhookId: id, // replay targets THIS endpoint only
  });
  if (created === 0)
    throw new AppError("validation_error", "Webhook is disabled or unsubscribed.", 400);
  return c.json({ data: { replayed: true, event: src.event } }, 201);
});

export default webhooks;
