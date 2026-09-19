import { Hono } from "hono";
import type { Env } from "../app.js";
import { createWebhookSchema } from "@calder/validation";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";
import { logger } from "@calder/observability";
import { encryptSecret } from "@calder/auth";
import { WEBHOOK_SECRET_CONTEXT, newWebhookSecret } from "../lib/webhook-secrets.js";

const webhooks = new Hono<Env>();

// POST /v1/webhooks — register an endpoint. The signing secret is returned
// EXACTLY ONCE here and stored ONLY AES-256-GCM encrypted (recoverable so the
// delivery engine can sign, never one-way hashed, never logged). There is no
// endpoint to read it back; losing it means rotating to a new secret via
// delete + re-create.
webhooks.post("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const body = await c.req.json().catch(() => null);
  if (!body) throw new AppError("validation_error", "Invalid JSON", 400);
  const parsed = createWebhookSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid webhook", 400, parsed.error.flatten());

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
  try {
    const { getDb, webhooks: webhooksTable } = await import("@calder/db");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(webhooksTable)
      .where(eq(webhooksTable.projectId, auth.projectId));
    // Stored ciphertexts must never be exposed to clients.
    return c.json({ data: rows.map(({ secret: _secret, ...rest }) => rest) });
  } catch {
    return c.json({ data: [] });
  }
});

export default webhooks;
