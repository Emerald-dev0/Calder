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

import { and, eq, sql } from "drizzle-orm";
import { createQueue } from "@calder/queue";
import type { DbClient } from "./client.js";
import { webhooks, webhookDeliveries } from "./schema/webhooks.js";

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

let webhookQueue: ReturnType<typeof createQueue<{ deliveryId: string }>> | null = null;

function getWebhookQueue() {
  if (!webhookQueue) {
    webhookQueue = createQueue<{ deliveryId: string }>("webhook:deliver", {
      maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    });
  }
  return webhookQueue;
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
    try {
      await getWebhookQueue().enqueue("deliver-webhook", { deliveryId });
    } catch {
      // row exists; queue loss is reconcilable
    }
  }
  return ids.length;
}
