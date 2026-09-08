import { Hono } from "hono";
import type { Env } from "../app.js";
import { sendEmailSchema } from "@calder/validation";
import { AppError, validationError } from "../errors/index.js";
import { handleSendEmail } from "../services/email-service.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";

const emails = new Hono<Env>();

// POST /v1/emails — send email (async via queue)
emails.post("/", authMiddleware, rateLimitMiddleware("sending"), async (c) => {
  const requestId = c.get("requestId");
  const auth = c.get("auth" as never) as {
    projectId: string;
    organizationId: string;
    apiKeyId: string;
    env: "test" | "live";
  };
  const idempotencyKey =
    c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key") ?? undefined;

  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");

  const parsed = sendEmailSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("validation_error", "Validation failed", 400, parsed.error.flatten());
  }

  const result = await handleSendEmail({
    projectId: auth.projectId,
    organizationId: auth.organizationId,
    apiKeyId: auth.apiKeyId,
    env: auth.env,
    requestId,
    idempotencyKey,
    input: parsed.data,
  });

  // Idempotent replay — return original response
  if (result.idempotentReplay) {
    return c.json(result.response, 200 as never);
  }

  return c.json(result.response, 202 as never);
});

// GET /v1/emails/:id — fetch email status (tenant-scoped)
emails.get("/:id", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const id = c.req.param("id");

  // Lazy DB fetch with tenant scoping
  try {
    const { getDb, emails: emailsTable } = await import("@calder/db");
    const { eq, and } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(emailsTable)
      .where(and(eq(emailsTable.id, id), eq(emailsTable.projectId, auth.projectId)))
      .limit(1);
    const email = rows[0];
    if (!email) throw new AppError("not_found", "Email not found", 404);
    return c.json({ data: email });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw err;
  }
});

// GET /v1/emails — list recent emails (tenant-scoped, paginated)
emails.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const page = Number.parseInt(c.req.query("page") ?? "1", 10);
  const perPage = Math.min(Number.parseInt(c.req.query("per_page") ?? "20", 10), 100);

  try {
    const { getDb, emails: emailsTable } = await import("@calder/db");
    const { eq, desc } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(emailsTable)
      .where(eq(emailsTable.projectId, auth.projectId))
      .orderBy(desc(emailsTable.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage);
    return c.json({ data: rows, pagination: { page, per_page: perPage } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // If DB unavailable (dev without postgres), return empty for scaffold
    return c.json({ data: [], pagination: { page, per_page: perPage } });
  }
});

export default emails;
