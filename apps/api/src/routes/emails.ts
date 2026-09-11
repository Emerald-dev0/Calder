import { Hono } from "hono";
import type { Env } from "../app.js";
import { sendEmailSchema } from "@calder/validation";
import { AppError, validationError } from "../errors/index.js";
import { handleSendEmail } from "../services/email-service.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";

const emails = new Hono<Env>();

// POST /v1/emails, send email (async via queue)
emails.post("/", authMiddleware, rateLimitMiddleware("sending"), async (c) => {
  const requestId = c.get("requestId");
  const auth = c.get("auth" as never) as {
    projectId: string;
    organizationId: string;
    apiKeyId: string;
    env: "test" | "live";
    scope?: string;
  };
  const { requireScope } = await import("../middleware/auth.js");
  requireScope(
    {
      type: "api_key",
      apiKeyId: auth.apiKeyId,
      projectId: auth.projectId,
      organizationId: auth.organizationId,
      env: auth.env,
      scope: auth.scope ?? "full",
      keyPrefix: "",
    },
    "send"
  );
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

  // Idempotent replay, return original response
  if (result.idempotentReplay) {
    return c.json(result.response, 200 as never);
  }

  return c.json(result.response, 202 as never);
});

// GET /v1/emails/:id, fetch email status (tenant-scoped, identity included)
emails.get("/:id", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const id = c.req.param("id");

  // Lazy DB fetch with tenant scoping
  try {
    const { getDb, emails: emailsTable, senderIdentities } = await import("@calder/db");
    const { eq, and } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(emailsTable)
      .where(and(eq(emailsTable.id, id), eq(emailsTable.projectId, auth.projectId)))
      .limit(1);
    const email = rows[0] as
      (Record<string, unknown> & { senderIdentityId?: string | null }) | undefined;
    if (!email) throw new AppError("not_found", "Email not found", 404);
    let sender: Record<string, unknown> | null = null;
    if (email.senderIdentityId) {
      const [s] = await db
        .select({
          id: senderIdentities.id,
          display_name: senderIdentities.displayName,
          email: senderIdentities.email,
          type: senderIdentities.type,
          status: senderIdentities.status,
        })
        .from(senderIdentities)
        .where(eq(senderIdentities.id, email.senderIdentityId))
        .limit(1);
      sender = (s as Record<string, unknown> | undefined) ?? null;
    }
    return c.json({ data: { ...email, sender } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw err;
  }
});

// GET /v1/emails, list (tenant-scoped). Filters: sender, status, since.
// Pagination: cursor (preferred) or legacy page/per_page.
emails.get("/", authMiddleware, async (c) => {
  const auth = c.get("auth" as never) as { projectId: string };
  const sender = c.req.query("sender") ?? undefined;
  const status = c.req.query("status") ?? undefined;
  const since = c.req.query("since") ?? undefined;
  const cursor = c.req.query("cursor") ?? undefined;
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
  const page = Number.parseInt(c.req.query("page") ?? "1", 10);
  const perPage = Math.min(Number.parseInt(c.req.query("per_page") ?? "20", 10), 100);

  try {
    const { getDb, emails: emailsTable } = await import("@calder/db");
    const { eq, and, desc, lt, gte, or } = await import("drizzle-orm");
    const db = getDb();
    const conds = [eq(emailsTable.projectId, auth.projectId)];
    if (sender) {
      conds.push(
        sender.startsWith("sender_")
          ? eq(emailsTable.senderIdentityId, sender)
          : eq(emailsTable.from, sender)
      );
    }
    if (status) conds.push(eq(emailsTable.status, status as never));
    if (since) {
      const ts = new Date(since);
      if (!Number.isNaN(ts.getTime())) conds.push(gte(emailsTable.createdAt, ts));
    }
    if (cursor) {
      // cursor = base64url(createdAtISO + "|" + id)
      try {
        const [ts, lastId] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
        const at = new Date(ts ?? "");
        if (!Number.isNaN(at.getTime()) && lastId) {
          conds.push(
            or(
              lt(emailsTable.createdAt, at),
              and(eq(emailsTable.createdAt, at), lt(emailsTable.id, lastId))
            )!
          );
        }
      } catch {
        // malformed cursor: ignore, first page
      }
    }
    const useCursor = cursor !== undefined;
    const rows = await db
      .select()
      .from(emailsTable)
      .where(and(...conds))
      .orderBy(desc(emailsTable.createdAt), desc(emailsTable.id))
      .limit(useCursor ? limit + 1 : perPage)
      .offset(useCursor ? 0 : (page - 1) * perPage);

    if (useCursor) {
      const hasMore = rows.length > limit;
      const page_rows = hasMore ? rows.slice(0, limit) : rows;
      const last = page_rows[page_rows.length - 1];
      const nextCursor =
        hasMore && last
          ? Buffer.from(`${new Date(last.createdAt).toISOString()}|${last.id}`, "utf8").toString(
              "base64url"
            )
          : null;
      return c.json({ data: page_rows, pagination: { limit, next_cursor: nextCursor } });
    }
    return c.json({ data: rows, pagination: { page, per_page: perPage } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    // If DB unavailable (dev without postgres), return empty for scaffold
    return c.json({ data: [], pagination: { page, per_page: perPage } });
  }
});

export default emails;
