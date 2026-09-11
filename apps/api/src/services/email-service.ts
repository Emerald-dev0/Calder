import { randomUUID } from "node:crypto";
import type { SendEmailInput } from "@calder/validation";
import { createQueue } from "@calder/queue";
import { logger } from "@calder/observability";
import { getConfig } from "@calder/config";
import { AppError } from "../errors/index.js";
import type { DbClient } from "@calder/db";

/**
 * Thin service layer, business logic outside HTTP handlers.
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

  // Custom headers ride in metadata (no schema change) and are allowlisted
  // below, envelope fields (From/To/Subject/Content-*/Received-*) can never
  // be smuggled through. Only List-Unsubscribe(-Post) and X-* pass.
  const safeHeaders = sanitizeHeaders(input.headers);
  // Sender identity resolution: sender_xxx IDs resolve to address + name and
  // stamp the delivery record; bare addresses take the legacy path.
  // Transport selection stays project-default here (worker owns it, Phase 9).
  let senderIdentityId: string | null = null;
  let senderEmail = input.from;
  let senderName: string | null = null;
  try {
    const { getDb } = await import("@calder/db");
    const { resolveSender } = await import("./sender-service.js");
    const resolved = await resolveSender(getDb(), projectId, input.from);
    senderIdentityId = resolved.senderIdentityId;
    senderEmail = resolved.email;
    senderName = resolved.displayName;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err, projectId }, "Sender resolution unavailable, legacy path");
  }
  const emailRecord = {
    id: emailId,
    projectId,
    idempotencyKey: idempotencyKey ?? null,
    from: senderEmail,
    senderIdentityId,
    fromName: senderName,
    to: input.to,
    cc: input.cc ?? null,
    bcc: input.bcc ?? null,
    replyTo: input.reply_to ?? null,
    subject: input.subject,
    html: input.html ?? null,
    text: input.text ?? null,
    metadata: {
      ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
      ...(Object.keys(safeHeaders).length > 0 ? { headers: safeHeaders } : {}),
    },
    status: "queued" as const,
    attemptCount: 0,
  };

  let persisted = false;
  try {
    const { getDb, emails, emailEvents } = await import("@calder/db");
    const db = getDb();
    await db.insert(emails).values({
      id: emailRecord.id,
      projectId: emailRecord.projectId,
      idempotencyKey: emailRecord.idempotencyKey,
      from: emailRecord.from,
      senderIdentityId: emailRecord.senderIdentityId,
      fromName: emailRecord.fromName,
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
      const { idempotencyKeys } = await import("@calder/db");
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
    const { getDb, idempotencyKeys } = await import("@calder/db");
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
    // DB unavailable, fallback to memory only
  }
  return null;
}

// Export queue for worker to share in-process (scaffold)
export function getSharedEmailQueue() {
  return getEmailQueue();
}

// ── Internal (dogfood) sends ─────────────────────────────────────
// Calder's own mail enters through this function, the same persist +
// enqueue path as customer sends, under the founder-owned tenant below.
// No HTTP loop, no special bypass, no separate provider. See
// docs/SYSTEM-EXPLAINED.md §5.
export const INTERNAL_ORG_ID = "org_avenor";
export const INTERNAL_PROJECT_ID = "proj_website";
export const INTERNAL_FROM = "Calder <hello@calder.click>";

/**
 * Allowlisted custom headers. Everything else (envelope fields, Content-*,
 * Received-*, or anything not matching) is dropped silently, the send
 * proceeds, the smuggling attempt does not.
 */
export function sanitizeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== "string" || value.length === 0 || value.length > 2000) continue;
    if (/^(list-unsubscribe(-post)?|x-[a-z0-9-]+)$/i.test(name.trim())) {
      out[name.trim()] = value;
    }
  }
  return out;
}

export interface InternalEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Sender override. Defaults to INTERNAL_FROM. Anything else must be an
 active Gmail transport label of the internal project, enforced below. */
  from?: string;
  /** When provided, branded footer links here for one-click unsubscribe. */
  unsubscribeUrl?: string;
  idempotencyKey: string;
  requestId: string;
}

/** Resolve a requested sender against what this project may actually send as. */
async function resolveInternalSender(db: DbClient, requested?: string): Promise<string> {
  if (!requested || requested === INTERNAL_FROM) return INTERNAL_FROM;
  const { projectTransports } = await import("@calder/db");
  const { eq, and } = await import("drizzle-orm");
  const rows = await db
    .select()
    .from(projectTransports)
    .where(
      and(
        eq(projectTransports.projectId, INTERNAL_PROJECT_ID),
        eq(projectTransports.status, "active")
      )
    )
    .limit(20);
  const match = rows.find(
    (r) => r.type === "gmail" && r.label.toLowerCase() === requested.toLowerCase()
  );
  if (!match) {
    throw new AppError(
      "validation_error",
      `Sender not authorized for this project. Use ${INTERNAL_FROM} or a connected Gmail address.`,
      400
    );
  }
  return match.label;
}

export async function sendInternalEmail(
  params: InternalEmailParams
): Promise<{ id: string; replay: boolean }> {
  const { getDb, organizations, projects } = await import("@calder/db");
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
      "Internal tenant not seeded, run: pnpm --filter @calder/db db:seed.",
      500
    );
  }
  const env = getConfig().NODE_ENV === "production" ? ("live" as const) : ("test" as const);
  // Compulsory branding: every internal mail ships inside the Calder layout.
  const { brandEmail } = await import("@calder/email");
  const result = await handleSendEmail({
    projectId: INTERNAL_PROJECT_ID,
    organizationId: INTERNAL_ORG_ID,
    apiKeyId: "internal",
    env,
    requestId: params.requestId,
    idempotencyKey: params.idempotencyKey,
    input: {
      from: await resolveInternalSender(db, params.from),
      to: params.to,
      subject: params.subject,
      html: brandEmail(params.html, {
        unsubscribeUrl: params.unsubscribeUrl,
        preheader: params.subject,
      }),
      text: params.text,
      headers: params.headers,
    },
  });
  return { id: result.response.id, replay: result.idempotentReplay };
}
