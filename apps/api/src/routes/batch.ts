import { Hono } from "hono";
import type { Env } from "../app.js";
import { bulkSendSchema } from "@calder/validation";
import { authMiddleware, requireScope, type AuthContext } from "../middleware/auth.js";
import { rateLimitMiddleware } from "../middleware/rate-limit.js";
import { AppError, validationError } from "../errors/index.js";
import { handleSendEmail } from "../services/email-service.js";
import { kickDrain, executionCtxOf } from "../lib/kick-drain.js";

const batch = new Hono<Env>();

// POST /v1/emails/batch, up to 100 messages in one call.
// Shared `from`/content at top level, per-message overrides below.
// Suppressed recipients are skipped (not billed, not an error).
// Idempotency-Key header acts as the base: message i dedupes on `${base}:${i}`.
batch.post("/", authMiddleware, rateLimitMiddleware("sending"), async (c) => {
  const a = c.get("auth" as never) as AuthContext & {
    organizationId: string;
    apiKeyId: string;
    env: "test" | "live";
    scope?: string;
  };
  requireScope(
    {
      type: "api_key",
      apiKeyId: a.apiKeyId,
      projectId: a.projectId,
      organizationId: a.organizationId,
      env: a.env,
      scope: a.scope ?? "full",
      keyPrefix: "",
    },
    "send"
  );
  const requestId = c.get("requestId");
  const body = await c.req.json().catch(() => null);
  if (!body) throw validationError("Invalid JSON body");
  const parsed = bulkSendSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("validation_error", "Invalid batch", 400, parsed.error.flatten());

  const { getDb, suppressions } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const suppressedRows = await db
    .select({ email: suppressions.email })
    .from(suppressions)
    .where(eq(suppressions.projectId, a.projectId));
  const suppressed = new Set(suppressedRows.map((r) => r.email.toLowerCase()));

  const baseKey = c.req.header("idempotency-key") ?? c.req.header("Idempotency-Key") ?? undefined;
  const results: Array<{ to: string; id?: string; status: string; reason?: string }> = [];
  let accepted = 0;
  let skipped = 0;

  const shared = parsed.data;
  for (let i = 0; i < shared.messages.length; i++) {
    const m = shared.messages[i]!;
    const to = m.to.trim().toLowerCase();
    if (suppressed.has(to)) {
      skipped++;
      results.push({ to, status: "skipped", reason: "suppressed" });
      continue;
    }
    const subject = m.subject ?? shared.subject;
    const html = m.html ?? shared.html;
    const text = m.text ?? shared.text;
    const template = m.template ?? shared.template;
    const variables = m.variables ?? shared.variables;
    if (!subject || (!html && !text && !template)) {
      skipped++;
      results.push({ to, status: "skipped", reason: "missing subject or body" });
      continue;
    }
    try {
      const result = await handleSendEmail({
        projectId: a.projectId,
        organizationId: a.organizationId,
        apiKeyId: a.apiKeyId,
        env: a.env,
        requestId,
        idempotencyKey: baseKey ? `${baseKey}:${i}` : undefined,
        input: {
          from: shared.from,
          to,
          subject,
          ...(html !== undefined ? { html } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(template !== undefined ? { template } : {}),
          ...(variables !== undefined ? { variables } : {}),
        },
      });
      accepted++;
      results.push({ to, id: result.response.id, status: result.response.status });
    } catch (err) {
      skipped++;
      results.push({
        to,
        status: "skipped",
        reason: err instanceof AppError ? err.message : "send failed",
      });
    }
  }

  kickDrain(executionCtxOf(c));

  return c.json({ data: { accepted, skipped, results } }, 202);
});

export default batch;
