/**
 * Outgoing webhook deliveries (Phase 3 / M3.1, ADR-038).
 *
 * Durability rules:
 * - A delivery is a DATABASE ROW FIRST. enqueueWebhookDeliveries writes the
 *   `webhook_deliveries` rows for every subscribed, enabled webhook, and only
 *   then queues jobs carrying the delivery id. Losing a queue message never
 *   loses the fact a delivery is owed; the row is the replay surface.
 * - Exactly one signing contract: envelope `{id, type, createdAt, data}`,
 *   JSON-encoded once; `webhook-signature: t=<unix>,v1=<hmac-sha256>` over
 *   `t + "." + body` (Stripe/Resend convention, timing-safe verifiable).
 * - Secrets are AES-256-GCM with context "webhook_signing" (schema comment
 *   pre-existing; this is the single contract consumers decrypt against).
 */

import { and, eq, lte, or, sql } from "drizzle-orm";
import type { DbClient, DbExecutor } from "./client.js";
import { enqueueJob } from "./jobs.js";
import { projects } from "./schema/projects.js";
import { jobs } from "./schema/queue.js";
import { webhookDeliveryAttempts, webhooks, webhookDeliveries } from "./schema/webhooks.js";

/** Encryption context for @calder/auth encryptSecret/decryptSecret. */
export const WEBHOOK_SECRET_CONTEXT = "webhook_signing";

/** Attempt schedule (1-indexed attempt that just failed → wait before next). */
const RETRY_SCHEDULE_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000];

export const WEBHOOK_MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1; // 8

/** Delay before attempt `failedAttempt + 1`; null when exhausted. */
export function nextRetryDelayMs(failedAttempt: number): number | null {
  if (failedAttempt > RETRY_SCHEDULE_MS.length) return null;
  return RETRY_SCHEDULE_MS[Math.max(0, failedAttempt - 1)]!;
}

export interface WebhookEnvelope {
  id: string;
  type: string;
  createdAt: string;
  data: Record<string, unknown>;
}

function newDeliveryId(): string {
  return `whd_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Write a pending delivery row for every enabled webhook of `projectId`
 * subscribed to `event`. Returns the created delivery ids (0+).
 */
export async function createPendingDeliveries(
  db: DbClient,
  params: { projectId: string; event: string; data: Record<string, unknown>; webhookId?: string }
): Promise<string[]> {
  const hooks = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.projectId, params.projectId),
        eq(webhooks.enabled, true),
        sql`${webhooks.events} ? ${params.event}`,
        ...(params.webhookId ? [eq(webhooks.id, params.webhookId)] : [])
      )
    );
  const ids: string[] = [];
  for (const hook of hooks) {
    const deliveryId = newDeliveryId();
    const envelope: WebhookEnvelope = {
      id: deliveryId,
      type: params.event,
      createdAt: new Date().toISOString(),
      data: params.data,
    };
    await db.insert(webhookDeliveries).values({
      id: deliveryId,
      webhookId: hook.id,
      projectId: params.projectId,
      event: params.event as never,
      payload: envelope as never,
      status: "pending",
      attemptCount: 0,
    });
    ids.push(deliveryId);
  }
  return ids;
}

async function projectOrganizationId(db: DbExecutor, projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: projects.organizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row?.organizationId ?? null;
}

/** Enqueue one durable delivery job. Idempotent per delivery id. */
export async function enqueueWebhookJob(
  db: DbClient,
  input: { deliveryId: string; projectId: string; replay?: boolean }
): Promise<boolean> {
  const accountId = await projectOrganizationId(db, input.projectId);
  try {
    await enqueueJob(db, {
      type: "webhook.deliver",
      accountId,
      payload: { deliveryId: input.deliveryId, projectId: input.projectId },
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
      idempotencyKey: input.replay
        ? `whd:${input.deliveryId}:replay:${Date.now()}`
        : `whd:${input.deliveryId}`,
    });
    return true;
  } catch {
    // The delivery row is the durable record; `repairMissingWebhookJobs`
    // re-creates a lost wake-up. Never fail the business event because the
    // queue insert failed.
    return false;
  }
}

/**
 * The full fire path: durable rows first, then queue jobs. Best-effort on
 * the queue leg (matches existing swarm semantics: a lost job leaves a
 * pending row the reconciler/consumer can pick up later).
 */
export async function enqueueWebhookDeliveries(
  db: DbClient,
  params: { projectId: string; event: string; data: Record<string, unknown>; webhookId?: string }
): Promise<number> {
  const ids = await createPendingDeliveries(db, params);
  for (const deliveryId of ids) {
    await enqueueWebhookJob(db, { deliveryId, projectId: params.projectId });
  }
  return ids.length;
}

/**
 * Repair wake-ups that never made it into `jobs` (legacy rows created before
 * the Postgres queue, a crashed producer, or a lost insert). Idempotent: the
 * `NOT EXISTS` only picks deliveries with no pending/processing job.
 */
export async function repairMissingWebhookJobs(db: DbClient, limit = 50): Promise<number> {
  const due = await db
    .select({
      id: webhookDeliveries.id,
      projectId: webhookDeliveries.projectId,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        or(
          sql`${webhookDeliveries.nextAttemptAt} is null`,
          lte(webhookDeliveries.nextAttemptAt, new Date())
        ),
        sql`not exists (
          select 1 from ${jobs}
           where ${jobs.jobType} = 'webhook.deliver'
             and ${jobs.status} in ('pending', 'processing')
             and ${jobs.payload}->>'deliveryId' = ${webhookDeliveries.id}
        )`
      )
    )
    .limit(Math.max(1, Math.min(limit, 200)));

  let repaired = 0;
  for (const row of due) {
    if (await enqueueWebhookJob(db, { deliveryId: row.id, projectId: row.projectId })) {
      repaired++;
    }
  }
  return repaired;
}

/**
 * Atomically take ownership of one delivery attempt. Returns null when another
 * processor already owns it, it is terminal, or it is not due yet.
 */
export async function claimWebhookDelivery(
  db: DbClient,
  input: { deliveryId: string; workerId: string; leaseSeconds?: number }
): Promise<{
  id: string;
  webhookId: string;
  projectId: string;
  payload: Record<string, unknown>;
  attemptCount: number;
} | null> {
  const lease = Math.max(10, Math.min(input.leaseSeconds ?? 120, 900));
  const rows = await db
    .update(webhookDeliveries)
    .set({
      status: "sending",
      lockedBy: input.workerId,
      lockExpiresAt: sql`now() + (${lease} * interval '1 second')`,
    })
    .where(
      and(
        eq(webhookDeliveries.id, input.deliveryId),
        eq(webhookDeliveries.status, "pending"),
        or(
          sql`${webhookDeliveries.nextAttemptAt} is null`,
          lte(webhookDeliveries.nextAttemptAt, new Date())
        )
      )
    )
    .returning({
      id: webhookDeliveries.id,
      webhookId: webhookDeliveries.webhookId,
      projectId: webhookDeliveries.projectId,
      payload: webhookDeliveries.payload,
      attemptCount: webhookDeliveries.attemptCount,
    });
  return rows[0] ?? null;
}

/** Return crashed attempts to pending. Safe to run concurrently. */
export async function recoverExpiredWebhookDeliveries(db: DbClient): Promise<number> {
  const rows = await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      lockedBy: null,
      lockExpiresAt: null,
      nextAttemptAt: sql`now()`,
      lastError: "delivery attempt interrupted before its result was recorded",
    })
    .where(
      and(
        eq(webhookDeliveries.status, "sending"),
        sql`${webhookDeliveries.lockExpiresAt} is not null`,
        sql`${webhookDeliveries.lockExpiresAt} < now()`
      )
    )
    .returning({ id: webhookDeliveries.id });
  return rows.length;
}

/** Extend an attempt lease while the HTTP request is in flight. */
export async function renewWebhookLease(
  db: DbClient,
  input: { deliveryId: string; workerId: string; seconds?: number }
): Promise<boolean> {
  const seconds = Math.max(10, Math.min(input.seconds ?? 120, 900));
  const rows = await db
    .update(webhookDeliveries)
    .set({ lockExpiresAt: sql`now() + (${seconds} * interval '1 second')` })
    .where(
      and(
        eq(webhookDeliveries.id, input.deliveryId),
        eq(webhookDeliveries.status, "sending"),
        eq(webhookDeliveries.lockedBy, input.workerId)
      )
    )
    .returning({ id: webhookDeliveries.id });
  return rows.length > 0;
}

export async function recordWebhookAttempt(
  db: DbExecutor,
  input: {
    deliveryId: string;
    projectId: string;
    attempt: number;
    outcome: "delivered" | "retryable" | "permanent";
    responseStatus?: number | null;
    latencyMs?: number | null;
    error?: string | null;
  }
): Promise<void> {
  await db.insert(webhookDeliveryAttempts).values({
    id: `wha_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    deliveryId: input.deliveryId,
    projectId: input.projectId,
    attempt: input.attempt,
    outcome: input.outcome,
    responseStatus: input.responseStatus ?? null,
    latencyMs: input.latencyMs ?? null,
    error: input.error ? input.error.slice(0, 2000) : null,
  });
}

/**
 * Finish a claimed attempt. `owner` is the processor that owns the lease, so a
 * late result from a processor that already lost its lease cannot overwrite a
 * newer attempt.
 */
export async function finishWebhookAttempt(
  db: DbClient,
  input: {
    deliveryId: string;
    projectId: string;
    workerId: string;
    attempt: number;
    outcome: "delivered" | "retryable" | "permanent" | "exhausted";
    responseStatus?: number | null;
    latencyMs?: number | null;
    error?: string | null;
    nextAttemptAt?: Date | null;
  }
): Promise<boolean> {
  const rows = await db
    .update(webhookDeliveries)
    .set({
      status:
        input.outcome === "delivered"
          ? "delivered"
          : input.outcome === "exhausted"
            ? "exhausted"
            : input.outcome === "permanent"
              ? "failed"
              : "pending",
      attemptCount: input.attempt,
      responseStatus: input.responseStatus ?? null,
      latencyMs: input.latencyMs ?? null,
      lastError: input.outcome === "delivered" ? null : (input.error ?? null),
      nextAttemptAt: input.outcome === "retryable" ? (input.nextAttemptAt ?? null) : null,
      deliveredAt: input.outcome === "delivered" ? new Date() : null,
      lockedBy: null,
      lockExpiresAt: null,
    })
    .where(
      and(
        eq(webhookDeliveries.id, input.deliveryId),
        eq(webhookDeliveries.projectId, input.projectId),
        eq(webhookDeliveries.status, "sending"),
        eq(webhookDeliveries.lockedBy, input.workerId)
      )
    )
    .returning({ id: webhookDeliveries.id });
  return rows.length > 0;
}

/**
 * Operator action: give a terminal/failed delivery a fresh retry cycle.
 * History stays in `webhook_delivery_attempts`; the row's attempt counter is
 * reset so the new cycle gets the full documented budget.
 */
export async function reprocessWebhookDelivery(
  db: DbClient,
  deliveryId: string
): Promise<{ requeued: boolean; reason?: string }> {
  const [delivery] = await db
    .select({
      id: webhookDeliveries.id,
      projectId: webhookDeliveries.projectId,
      status: webhookDeliveries.status,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) return { requeued: false, reason: "not_found" };
  if (delivery.status === "sending") return { requeued: false, reason: "in_flight" };
  if (delivery.status === "delivered") return { requeued: false, reason: "already_delivered" };

  const rows = await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      lockedBy: null,
      lockExpiresAt: null,
    })
    .where(eq(webhookDeliveries.id, deliveryId))
    .returning({ id: webhookDeliveries.id });
  if (rows.length === 0) return { requeued: false, reason: "not_found" };
  const queued = await enqueueWebhookJob(db, {
    deliveryId,
    projectId: delivery.projectId,
    replay: true,
  });
  return queued ? { requeued: true } : { requeued: false, reason: "enqueue_failed" };
}

export interface WebhookQueueMetrics {
  pending: number;
  due: number;
  sending: number;
  expiredLeases: number;
  delivered: number;
  failed: number;
  exhausted: number;
  oldestPendingAgeSeconds: number | null;
}

export async function webhookQueueMetrics(db: DbExecutor): Promise<WebhookQueueMetrics> {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      due: sql<number>`count(*) filter (where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now()))`,
      sending: sql<number>`count(*) filter (where status = 'sending')`,
      expiredLeases: sql<number>`count(*) filter (where status = 'sending' and lock_expires_at < now())`,
      delivered: sql<number>`count(*) filter (where status = 'delivered')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
      exhausted: sql<number>`count(*) filter (where status = 'exhausted')`,
      oldestPendingAge: sql<
        number | null
      >`extract(epoch from (now() - min(created_at) filter (where status = 'pending')))`,
    })
    .from(webhookDeliveries);
  return {
    pending: Number(row?.pending ?? 0),
    due: Number(row?.due ?? 0),
    sending: Number(row?.sending ?? 0),
    expiredLeases: Number(row?.expiredLeases ?? 0),
    delivered: Number(row?.delivered ?? 0),
    failed: Number(row?.failed ?? 0),
    exhausted: Number(row?.exhausted ?? 0),
    oldestPendingAgeSeconds:
      row?.oldestPendingAge === null || row?.oldestPendingAge === undefined
        ? null
        : Number(row.oldestPendingAge),
  };
}

export interface FailedDeliveryRow {
  id: string;
  projectId: string;
  event: string;
  status: string;
  attemptCount: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  endpoint: string;
}

/**
 * Dead-letter inspection for webhooks: the terminal-but-retryable rows. The
 * endpoint is returned (operators need to know which one), but the signing
 * secret never leaves the database in plaintext.
 */
export async function listFailedWebhookDeliveries(
  db: DbExecutor,
  limit = 50
): Promise<FailedDeliveryRow[]> {
  return db
    .select({
      id: webhookDeliveries.id,
      projectId: webhookDeliveries.projectId,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attemptCount: webhookDeliveries.attemptCount,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
      endpoint: webhooks.url,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(sql`${webhookDeliveries.status} in ('failed', 'exhausted')`)
    .orderBy(sql`${webhookDeliveries.createdAt} desc`)
    .limit(Math.max(1, Math.min(limit, 200)));
}
