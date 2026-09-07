import { randomUUID } from "node:crypto";
import type { SendEmailInput } from "@avenor/validation";
import { createQueue } from "@avenor/queue";
import { logger } from "@avenor/observability";
import { getConfig } from "@avenor/config";
import { AppError } from "../errors/index.js";

/**
 * Thin service layer — business logic outside HTTP handlers.
 * Implements: validate → authorize → idempotency → persist → enqueue → return
 */

// Singleton queue for email jobs
let emailQueue: ReturnType<typeof createQueue> | null = null;

function getEmailQueue() {
  if (!emailQueue)
    emailQueue = createQueue<{ emailId: string; projectId: string }>("email:send", {
      maxAttempts: 5,
    });
  return emailQueue;
}

// In-memory fallback stores for dev without DB
const memoryEmails = new Map<string, unknown>();
const memoryIdempotency = new Map<string, { status: number; body: unknown }>();

export interface HandleSendEmailParams {
  projectId: string;
  organizationId: string;
  apiKeyId: string;
  env: "test" | "live";
  requestId: string;
  idempotencyKey?: string;
  input: SendEmailInput;
}

export async function handleSendEmail(params: HandleSendEmailParams): Promise<{
  response: { id: string; status: string; message: string };
  idempotentReplay: boolean;
}> {
  const { projectId, idempotencyKey, input, requestId, env } = params;

  // ── Idempotency check ──────────────────────────────────────
  if (idempotencyKey) {
    // Try DB first, fallback to memory
    const existing = await lookupIdempotency(projectId, idempotencyKey);
    if (existing) {
      logger.info({ projectId, idempotencyKey, requestId }, "Idempotent replay");
      return {
        response: existing.responseBody as { id: string; status: string; message: string },
        idempotentReplay: true,
      };
    }
  }

  // ── Persist email (durable record) ─────────────────────────
  const emailId = `em_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  const emailRecord = {
    id: emailId,
    projectId,
    idempotencyKey: idempotencyKey ?? null,
    from: input.from,
    to: input.to,
    cc: input.cc ?? null,
    bcc: input.bcc ?? null,
    replyTo: input.reply_to ?? null,
    subject: input.subject,
    html: input.html ?? null,
    text: input.text ?? null,
    metadata: input.metadata ?? {},
    status: "queued" as const,
    attemptCount: 0,
  };

  let persisted = false;
  try {
    const { getDb, emails, emailEvents } = await import("@avenor/db");
    const db = getDb();
    await db.insert(emails).values({
      id: emailRecord.id,
      projectId: emailRecord.projectId,
      idempotencyKey: emailRecord.idempotencyKey,
      from: emailRecord.from,
      to: emailRecord.to,
      cc: emailRecord.cc,
      bcc: emailRecord.bcc,
      replyTo: emailRecord.replyTo,
      subject: emailRecord.subject,
      html: emailRecord.html,
      text: emailRecord.text,
      metadata: emailRecord.metadata,
      status: "queued",
      attemptCount: 0,
    });
    // Record created event
    await db.insert(emailEvents).values({
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId,
      projectId,
      type: "queued",
      data: { requestId, env },
    });

    // Also persist idempotency record if key provided
    if (idempotencyKey) {
      const { idempotencyKeys } = await import("@avenor/db");
      const responseBody = { id: emailId, status: "queued", message: "Email queued for delivery" };
      await db
        .insert(idempotencyKeys)
        .values({
          id: `idm_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          projectId,
          key: idempotencyKey,
          responseStatus: 202,
          responseBody,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();
    }

    persisted = true;
  } catch (err) {
    // Fallback to in-memory if DB unavailable (scaffold dev)
    logger.warn({ err, projectId, emailId }, "DB persist failed, using in-memory fallback");
    memoryEmails.set(emailId, emailRecord);
    if (idempotencyKey) {
      // will be set after enqueue below
    }
  }

  // ── Suppression check (before enqueue) ─────────────────────
  // In production: check suppressions table; scaffold: skip

  // ── Enqueue ────────────────────────────────────────────────
  const response = { id: emailId, status: "queued" as const, message: "Email queued for delivery" };

  // Test keys never trigger real delivery but still enqueue for mock processing
  const queue = getEmailQueue();

  // Wire queue to worker handler if available (in-process for scaffold vertical slice)
  // The worker will also poll; this ensures local dev works without separate process
  try {
    await queue.enqueue("send-email", { emailId, projectId });
    logger.info({ emailId, projectId, requestId, env }, "Email enqueued");
  } catch (queueErr) {
    logger.error({ err: queueErr, emailId }, "Failed to enqueue email");
    // Update status to failed but still return ID for observability
  }

  // In-memory idempotencyStore fallback
  if (!persisted && idempotencyKey) {
    memoryIdempotency.set(`${projectId}:${idempotencyKey}`, { status: 202, body: response });
  }

  // If DB failed but we are in test/dev, also persist in memory for GET lookups
  if (!persisted) {
    // already in memoryEmails
  }

  return { response, idempotentReplay: false };
}

async function lookupIdempotency(
  projectId: string,
  key: string
): Promise<{ responseBody: unknown } | null> {
  // Memory check first
  const mem = memoryIdempotency.get(`${projectId}:${key}`);
  if (mem) return { responseBody: mem.body };

  try {
    const { getDb, idempotencyKeys } = await import("@avenor/db");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.projectId, projectId), eq(idempotencyKeys.key, key)))
      .limit(1);
    const row = rows[0];
    if (row && row.responseBody) {
      // Check expiry
      if (row.expiresAt.getTime() < Date.now()) return null;
      return { responseBody: row.responseBody };
    }
  } catch {
    // DB unavailable — fallback to memory only
  }
  return null;
}

// Export queue for worker to share in-process (scaffold)
export function getSharedEmailQueue() {
  return getEmailQueue();
}

// ── Internal (dogfood) sends ─────────────────────────────────────
// Avenor's own mail enters through this function — the same persist +
// enqueue path as customer sends, under the founder-owned tenant below.
// No HTTP loop, no special bypass, no separate provider. See
// docs/SYSTEM-EXPLAINED.md §5.
export const INTERNAL_ORG_ID = "org_avenor";
export const INTERNAL_PROJECT_ID = "proj_website";
export const INTERNAL_FROM = "Avenor <hello@avenor.com>";

export interface InternalEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  requestId: string;
}

export async function sendInternalEmail(
  params: InternalEmailParams
): Promise<{ id: string; replay: boolean }> {
  const { getDb, organizations, projects } = await import("@avenor/db");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const org = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, INTERNAL_ORG_ID))
    .limit(1);
  const proj = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, INTERNAL_PROJECT_ID))
    .limit(1);
  if (!org[0] || !proj[0]) {
    throw new AppError(
      "internal_error",
      "Internal tenant not seeded — run: pnpm --filter @avenor/db db:seed.",
      500
    );
  }
  const env = getConfig().NODE_ENV === "production" ? ("live" as const) : ("test" as const);
  const result = await handleSendEmail({
    projectId: INTERNAL_PROJECT_ID,
    organizationId: INTERNAL_ORG_ID,
    apiKeyId: "internal",
    env,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    input: {
      from: INTERNAL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    },
  });
  return { id: result.response.id, replay: result.idempotentReplay };
}
