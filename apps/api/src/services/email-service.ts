import { randomUUID } from "node:crypto";
import type { SendEmailInput } from "@calder/validation";
import { createQueue } from "@calder/queue";
import { logger } from "@calder/observability";
import { getConfig, isProduction } from "@calder/config";
import { AppError } from "../errors/index.js";
import type { DbClient } from "@calder/db";

/** postgres.js unique-violation error shape (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

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

/**
 * Reputation lane for a send: `transactional` unless the caller explicitly
 * opted in to `marketing`. Callers that bypass the request schema (internal
 * mail, legacy code paths) therefore stay transactional, and the column can
 * never be written empty. This function is an ANNOTATION ONLY — suppression,
 * quota, consent and sender-verification checks run before it and are never
 * stream-conditional (see the gates in handleSendEmail).
 */
export function resolveEmailStream(input: {
  stream?: "transactional" | "marketing";
}): "transactional" | "marketing" {
  return input.stream === "marketing" ? "marketing" : "transactional";
}

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
  // Template send-by-alias: latest version wins; missing variables are a
  // 400 naming every gap (silent defaults send the wrong email to someone).
  let subject = input.subject;
  let html = input.html ?? null;
  let text = input.text ?? null;
  if (input.template) {
    try {
      const { getDb, templates, templateVersions } = await import("@calder/db");
      const { eq, and, desc } = await import("drizzle-orm");
      const db = getDb();
      const [tpl] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(and(eq(templates.projectId, projectId), eq(templates.alias, input.template)))
        .limit(1);
      if (!tpl) {
        throw new AppError(
          "not_found",
          `Template "${input.template}" does not exist on this project.`,
          404,
          undefined,
          "Create it via POST /v1/templates first."
        );
      }
      const [latest] = await db
        .select()
        .from(templateVersions)
        .where(eq(templateVersions.templateId, tpl.id))
        .orderBy(desc(templateVersions.createdAt))
        .limit(1);
      if (!latest || (!latest.subject && !latest.html && !latest.text)) {
        throw new AppError(
          "validation_error",
          `Template "${input.template}" has no content yet.`,
          400,
          undefined,
          "Add a version via POST /v1/templates/:id/versions first."
        );
      }
      subject = subject ?? latest.subject ?? "";
      html = html ?? latest.html ?? null;
      text = text ?? latest.text ?? null;
      const vars = (input.variables as Record<string, string> | undefined) ?? {};
      const missing = new Set<string>();
      const fill = (s: string | null): string | null =>
        s === null
          ? null
          : s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => {
              const v = vars[key];
              if (v === undefined) {
                missing.add(key);
                return m;
              }
              return v;
            });
      subject = fill(subject) ?? "";
      html = fill(html);
      text = fill(text);
      if (missing.size > 0) {
        throw new AppError(
          "validation_error",
          `Missing template variables: ${[...missing].join(", ")}.`,
          400,
          undefined,
          "Pass every {{variable}} in the variables object."
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.warn({ err, projectId }, "Template resolution unavailable");
      throw new AppError("internal_error", "Could not resolve template.", 500);
    }
  }
  if (!subject || (!html && !text)) {
    throw new AppError(
      "validation_error",
      "Send needs a subject and html, text, or a template that provides them.",
      400
    );
  }

  // Scheduled sends hold in the delayed queue; the record carries the time.
  let scheduledFor: Date | null = null;
  let delayMs: number | undefined;
  if (input.scheduled_at) {
    scheduledFor = new Date(input.scheduled_at);
    delayMs = Math.max(0, scheduledFor.getTime() - Date.now());
  }

  // ── Suppression check (ARCHITECTURE §9: before every send) ──
  // Checked at ingest so a suppressed recipient is rejected with a reason
  // (4xx) instead of being persisted, queued and blocked silently later.
  // Worker and drain re-check before delivery, so an unsubscribe landing
  // after acceptance is still honored.
  try {
    const { getDb, suppressions } = await import("@calder/db");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();
    const sup = await db
      .select({ reason: suppressions.reason })
      .from(suppressions)
      .where(and(eq(suppressions.projectId, projectId), eq(suppressions.email, input.to)))
      .limit(1);
    if (sup.length > 0) {
      throw new AppError(
        "suppressed",
        `Recipient is suppressed for this project (${sup[0]!.reason}). The email was not queued.`,
        422,
        undefined,
        "Remove the address from the suppression list first, or send to a different recipient."
      );
    }
  } catch (supErr) {
    if (supErr instanceof AppError) throw supErr;
    // Never send on an unverifiable suppression state. In production this
    // fails closed; without a DB (local scaffold) it degrades with a warning.
    if (isProduction()) {
      logger.error({ err: supErr, projectId }, "Suppression check failed at ingest");
      throw new AppError(
        "internal_error",
        "Suppression state unavailable; the send was not accepted.",
        500
      );
    }
    logger.warn({ err: supErr, projectId }, "Suppression check unavailable, skipping (dev)");
  }

  // ── Quota check (PRICING §5: hard limits, no silent overages) ──
  // After suppression (never charge a refused send) and BEFORE persistence.
  // Idempotent replays returned earlier and never re-hit this gate; test-key
  // traffic and Calder's internal org are exempt by policy.
  {
    const { getDb } = await import("@calder/db");
    const { checkSendQuota, assertQuotaAllowed } = await import("../lib/quotas.js");
    assertQuotaAllowed(await checkSendQuota(getDb(), params.organizationId, env));
  }

  const emailRecord = {
    id: emailId,
    projectId,
    idempotencyKey: idempotencyKey ?? null,
    env,
    from: senderEmail,
    senderIdentityId,
    fromName: senderName,
    scheduledFor,
    attachments: input.attachments ?? null,
    to: input.to,
    cc: input.cc ?? null,
    bcc: input.bcc ?? null,
    replyTo: input.reply_to ?? null,
    subject,
    html,
    text,
    metadata: {
      ...((input.metadata as Record<string, unknown> | undefined) ?? {}),
      ...(Object.keys(safeHeaders).length > 0 ? { headers: safeHeaders } : {}),
    },
    // Annotation recorded after every gate (sender, suppression, quota) has
    // passed; it cannot grant a bypass of any of them.
    stream: resolveEmailStream(input),
    status: "queued" as const,
    attemptCount: 0,
  };

  const response = { id: emailId, status: "queued" as const, message: "Email queued for delivery" };

  // ── Persist + atomic idempotency claim ─────────────────────
  // With an Idempotency-Key the claim row is inserted FIRST, inside the
  // same transaction as the email row. INSERT ... ON CONFLICT waits for a
  // concurrent transaction holding the same key, then either replays the
  // committed response (no second row, no second send) or becomes the
  // winner when the loser rolled back. Concurrent same-key sends can no
  // longer produce duplicate deliveries.
  let persisted = false;
  try {
    const { getDb, emails, emailEvents, idempotencyKeys } = await import("@calder/db");
    const db = getDb();
    const insertEmail = {
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
      scheduledFor: emailRecord.scheduledFor,
      attachments: emailRecord.attachments,
      stream: emailRecord.stream,
      status: "queued" as const,
      attemptCount: 0,
    };
    const queuedEvent = {
      id: `ev_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      emailId,
      projectId,
      type: "queued" as const,
      data: { requestId, env },
    };

    if (idempotencyKey) {
      const { and, eq, lt } = await import("drizzle-orm");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const claimed = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(idempotencyKeys)
          .values({
            id: `idm_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            projectId,
            key: idempotencyKey,
            responseStatus: null,
            responseBody: null,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [idempotencyKeys.projectId, idempotencyKeys.key],
            // An expired claim may be refreshed and re-claimed. A live
            // claim fails this WHERE, RETURNING comes back empty, and the
            // committed response is replayed below instead.
            set: { expiresAt, responseStatus: null, responseBody: null },
            setWhere: lt(idempotencyKeys.expiresAt, new Date()),
          })
          .returning({ id: idempotencyKeys.id });

        if (rows.length === 0) return false;

        await tx.insert(emails).values(insertEmail);
        await tx.insert(emailEvents).values(queuedEvent);
        await tx
          .update(idempotencyKeys)
          .set({ responseStatus: 202, responseBody: response })
          .where(
            and(eq(idempotencyKeys.projectId, projectId), eq(idempotencyKeys.key, idempotencyKey))
          );
        return true;
      });

      if (!claimed) {
        // ON CONFLICT waits for the winner's transaction to commit, so the
        // stored response is visible by now.
        const stored = await lookupIdempotency(projectId, idempotencyKey);
        if (stored) {
          logger.info({ projectId, idempotencyKey, requestId }, "Idempotent replay (concurrent)");
          return {
            response: stored.responseBody as { id: string; status: string; message: string },
            idempotentReplay: true,
          };
        }
        throw new AppError(
          "idempotency_conflict",
          "A request with this Idempotency-Key is already in flight.",
          409,
          undefined,
          "Retry with the same Idempotency-Key in a few seconds."
        );
      }
    } else {
      await db.insert(emails).values(insertEmail);
      await db.insert(emailEvents).values(queuedEvent);
    }

    persisted = true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (idempotencyKey && isUniqueViolation(err)) {
      // Defensive: claim won but the email row already existed. The
      // original response is the correct reply.
      const stored = await lookupIdempotency(projectId, idempotencyKey);
      if (stored) {
        return {
          response: stored.responseBody as { id: string; status: string; message: string },
          idempotentReplay: true,
        };
      }
      throw new AppError(
        "idempotency_conflict",
        "A send with this Idempotency-Key already exists.",
        409,
        undefined,
        "Retry with the same Idempotency-Key in a few seconds."
      );
    }
    if (isProduction()) {
      // Fail closed: a 202 without a durable row is a lost send.
      logger.error({ err, projectId, emailId }, "Failed to persist send");
      throw new AppError("internal_error", "Could not persist the send; nothing was queued.", 500);
    }
    // Dev scaffold without a database: keep the in-memory fallback alive.
    logger.warn({ err, projectId, emailId }, "DB persist failed, using in-memory fallback");
    memoryEmails.set(emailId, emailRecord);
  }

  // ── Enqueue ────────────────────────────────────────────────
  // A persisted "queued" row is the durable record; the cron drain is the
  // backstop that picks it up even if this enqueue call fails, so on
  // failure we log loudly rather than failing a send that is already safe.
  const queue = getEmailQueue();

  try {
    if (delayMs !== undefined && delayMs > 0) {
      await queue.enqueueDelayed("send-email", { emailId, projectId }, delayMs);
      logger.info({ emailId, projectId, requestId, env, delayMs }, "Email scheduled");
    } else {
      await queue.enqueue("send-email", { emailId, projectId });
      logger.info({ emailId, projectId, requestId, env }, "Email enqueued");
    }
  } catch (queueErr) {
    logger.error(
      { err: queueErr, emailId, projectId, persisted },
      persisted
        ? "Enqueue failed; send remains queued and the scheduled drain will pick it up"
        : "Enqueue failed for an unpersisted (dev in-memory) send"
    );
  }

  // Dev scaffold without a database also tracks idempotency in memory.
  if (!persisted && idempotencyKey) {
    memoryIdempotency.set(`${projectId}:${idempotencyKey}`, { status: 202, body: response });
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
// docs/SYSTEM-EXPLAINED.md §5. Single source for the internal-org id is
// lib/quotas.ts (quota logic depends on it); re-exported for compatibility.
import { INTERNAL_ORG_ID } from "../lib/quotas.js";
export { INTERNAL_ORG_ID };
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
  attachments?: Array<{ filename: string; contentType?: string; contentBase64: string }>;
  /** Sender override. Defaults to INTERNAL_FROM. Accepts email or sender_xxx; validated below. */
  from?: string;
  /** When provided, branded footer links here for one-click unsubscribe. */
  unsubscribeUrl?: string;
  idempotencyKey: string;
  requestId: string;
}

/** Resolve a requested sender against what this project may actually send as. Accepts email or sender_xxx. */
async function resolveInternalSender(db: DbClient, requested?: string): Promise<string> {
  if (!requested || requested === INTERNAL_FROM) return INTERNAL_FROM;
  // Try sender_xxx first via shared resolver
  if (requested.startsWith("sender_")) {
    try {
      const { resolveSender } = await import("./sender-service.js");
      const out = await resolveSender(db, INTERNAL_PROJECT_ID, requested);
      return out.email;
    } catch {
      // fall through to label check
    }
  }
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
  if (match) return match.label;
  // Also allow any verified sender email of the internal project
  try {
    const { resolveSender } = await import("./sender-service.js");
    const out = await resolveSender(db, INTERNAL_PROJECT_ID, requested);
    return out.email;
  } catch {
    throw new AppError(
      "validation_error",
      `Sender not authorized for this project. Use ${INTERNAL_FROM}, a sender_xxx ID, or a connected Gmail address.`,
      400
    );
  }
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
      // Calder's own mail (auth codes, receipts, lifecycle) is transactional
      // by definition and must never ride the marketing lane.
      stream: "transactional",
      to: params.to,
      subject: params.subject,
      html: brandEmail(params.html, {
        unsubscribeUrl: params.unsubscribeUrl,
        preheader: params.subject,
      }),
      text: params.text,
      headers: params.headers,
      attachments: params.attachments,
    },
  });
  return { id: result.response.id, replay: result.idempotentReplay };
}
