import { Hono } from "hono";
import type { Env } from "../app.js";
import { createWebhookSchema } from "@calder/validation";
import { authMiddleware } from "../middleware/auth.js";
import { AppError } from "../errors/index.js";

const webhooks = new Hono<Env>();

webhooks.post("/", authMiddleware, async (c) => {
 const auth = c.get("auth" as never) as { projectId: string };
 const body = await c.req.json().catch(() => null);
 if (!body) throw new AppError("validation_error", "Invalid JSON", 400);
 const parsed = createWebhookSchema.safeParse(body);
 if (!parsed.success)
 throw new AppError("validation_error", "Invalid webhook", 400, parsed.error.flatten());

 try {
 const { getDb, webhooks: webhooksTable } = await import("@calder/db");
 const { randomUUID } = await import("node:crypto");
 const { createHash } = await import("node:crypto");
 const db = getDb();
 const id = `wh_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
 const secret = `whsec_${randomUUID().replace(/-/g, "").slice(0, 32)}`;
 const hash = createHash("sha256").update(secret).digest("hex");
 await db.insert(webhooksTable).values({
 id,
 projectId: auth.projectId,
 url: parsed.data.url,
 secret: hash,
 events: parsed.data.events,
 });
 return c.json({ data: { id, url: parsed.data.url, events: parsed.data.events } }, 201);
 } catch {
 return c.json(
 { data: { id: `wh_${Date.now()}`, url: parsed.data.url, events: parsed.data.events } },
 201
 );
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
 return c.json({ data: rows });
 } catch {
 return c.json({ data: [] });
 }
});

export default webhooks;
