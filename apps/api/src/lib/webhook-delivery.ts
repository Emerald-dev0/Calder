/**
 * Webhook delivery handler for the PostgreSQL queue.
 *
 * Event vs attempt
 * ----------------
 * A **delivery** (`webhook_deliveries` row) is the durable business event for
 * one endpoint. Its id is the event id and never changes across retries. An
 * **attempt** (`webhook_delivery_attempts` row) is one HTTP request. Retries
 * create attempts, never new events.
 *
 * Exactly-once is not claimed: a crash between the endpoint accepting the
 * request and the attempt row being written is ambiguous, so the lease
 * recovery path retries it. Receivers must dedupe on `webhook-id`.
 */
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_SECRET_CONTEXT,
  claimWebhookDelivery,
  finishWebhookAttempt,
  nextRetryDelayMs,
  recordWebhookAttempt,
  webhookDeliveries,
  webhooks,
  type DbClient,
  type Job,
} from "@calder/db";
import { logger } from "@calder/observability";
import { postWebhook, redactWebhookUrl } from "./webhook-http.js";

export const WEBHOOK_LEASE_SECONDS = 120;

/** HTTP statuses that mean "this request will never be accepted as-is". */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 405, 410, 413, 414, 415, 422]);

export type WebhookOutcome = "delivered" | "retryable" | "permanent" | "exhausted";

export interface WebhookDeliveryResult {
  status: "delivered" | "retryable" | "permanent" | "exhausted" | "in_flight" | "missing";
  attempt: number;
  responseStatus?: number | null;
  latencyMs?: number | null;
  retryDelayMs?: number | null;
  error?: string | null;
}

export function buildSignatureHeader(secret: string, timestampSec: number, body: string): string {
  const sig = createHmac("sha256", secret).update(`${timestampSec}.${body}`, "utf8").digest("hex");
  return `t=${timestampSec},v1=${sig}`;
}

function classify(status: number): WebhookOutcome {
  if (status >= 200 && status < 300) return "delivered";
  if (PERMANENT_STATUSES.has(status)) return "permanent";
  return "retryable";
}

/**
 * Deliver one claimed job. State transitions are owned by this function:
 * the delivery row records the durable outcome and per-attempt history; the
 * caller only completes or retries the queue job.
 */
export async function deliverWebhookJob(
  db: DbClient,
  input: { job: Job; workerId: string }
): Promise<WebhookDeliveryResult> {
  const deliveryId = input.job.payload?.deliveryId;
  const payloadProject = input.job.payload?.projectId;
  if (typeof deliveryId !== "string" || typeof payloadProject !== "string") {
    return { status: "permanent", attempt: input.job.attempts, error: "invalid_job_payload" };
  }

  const claimed = await claimWebhookDelivery(db, {
    deliveryId,
    workerId: input.workerId,
    leaseSeconds: WEBHOOK_LEASE_SECONDS,
  });
  if (!claimed) return { status: "in_flight", attempt: input.job.attempts };
  if (claimed.projectId !== payloadProject) {
    // A job cannot steer another tenant's delivery. The claim is released by
    // marking the attempt failed permanently; nothing is sent.
    await finishWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      workerId: input.workerId,
      attempt: input.job.attempts,
      outcome: "permanent",
      error: "project_mismatch",
    });
    return { status: "permanent", attempt: input.job.attempts, error: "project_mismatch" };
  }

  const attempt = Math.max(1, input.job.attempts);
  const [hook] = await db
    .select({ url: webhooks.url, secret: webhooks.secret, enabled: webhooks.enabled })
    .from(webhooks)
    .where(and(eq(webhooks.id, claimed.webhookId), eq(webhooks.projectId, claimed.projectId)))
    .limit(1);

  if (!hook) {
    await recordWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      attempt,
      outcome: "permanent",
      error: "endpoint_deleted",
    });
    await finishWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      workerId: input.workerId,
      attempt,
      outcome: "permanent",
      error: "endpoint_deleted",
    });
    return { status: "permanent", attempt, error: "endpoint_deleted" };
  }
  if (!hook.enabled) {
    // Explicit policy: a disabled endpoint is a configuration decision, not a
    // transient failure. Stop burning attempts; the row stays inspectable and
    // can be reprocessed after re-enabling.
    await recordWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      attempt,
      outcome: "permanent",
      error: "endpoint_disabled",
    });
    await finishWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      workerId: input.workerId,
      attempt,
      outcome: "permanent",
      error: "endpoint_disabled",
    });
    return { status: "permanent", attempt, error: "endpoint_disabled" };
  }

  let secret: string;
  try {
    // @calder/auth depends on @calder/db; the import must stay dynamic so the
    // db package does not gain a reverse dependency.
    const { decryptSecret } = await import("@calder/auth");
    secret = decryptSecret(hook.secret, WEBHOOK_SECRET_CONTEXT);
  } catch {
    await recordWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      attempt,
      outcome: "permanent",
      error: "secret_decrypt_failed",
    });
    await finishWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      workerId: input.workerId,
      attempt,
      outcome: "permanent",
      error: "secret_decrypt_failed",
    });
    return { status: "permanent", attempt, error: "secret_decrypt_failed" };
  }

  // The stored envelope — not a re-render of current data — is what is signed
  // and sent. This is what keeps the payload byte-identical across retries.
  const body = JSON.stringify(claimed.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await postWebhook(
    hook.url,
    {
      "webhook-id": deliveryId,
      "webhook-signature": buildSignatureHeader(secret, timestamp, body),
    },
    body
  );

  if (result.kind === "response") {
    const outcome = classify(result.status);
    const nextAttemptAt =
      outcome === "retryable" && attempt < WEBHOOK_MAX_ATTEMPTS
        ? new Date(Date.now() + (nextRetryDelayMs(attempt) ?? 0))
        : null;
    const finalOutcome: WebhookOutcome =
      outcome === "retryable" && !nextAttemptAt ? "exhausted" : outcome;
    const error = finalOutcome === "delivered" ? null : `endpoint answered HTTP ${result.status}`;

    await recordWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      attempt,
      outcome: finalOutcome === "exhausted" ? "retryable" : finalOutcome,
      responseStatus: result.status,
      latencyMs: result.latencyMs,
      error,
    });
    await finishWebhookAttempt(db, {
      deliveryId,
      projectId: claimed.projectId,
      workerId: input.workerId,
      attempt,
      outcome: finalOutcome,
      responseStatus: result.status,
      latencyMs: result.latencyMs,
      error,
      nextAttemptAt,
    });
    logger.info(
      {
        deliveryId,
        attempt,
        status: result.status,
        outcome: finalOutcome,
        endpoint: redactWebhookUrl(hook.url),
      },
      "webhook attempt finished"
    );
    return {
      status: finalOutcome,
      attempt,
      responseStatus: result.status,
      latencyMs: result.latencyMs,
      retryDelayMs: nextAttemptAt ? Math.max(0, nextAttemptAt.getTime() - Date.now()) : null,
      error,
    };
  }

  const nextAttemptAt =
    attempt < WEBHOOK_MAX_ATTEMPTS ? new Date(Date.now() + (nextRetryDelayMs(attempt) ?? 0)) : null;
  const finalOutcome: WebhookOutcome = nextAttemptAt ? "retryable" : "exhausted";
  await recordWebhookAttempt(db, {
    deliveryId,
    projectId: claimed.projectId,
    attempt,
    outcome: "retryable",
    latencyMs: result.latencyMs,
    error: result.error,
  });
  await finishWebhookAttempt(db, {
    deliveryId,
    projectId: claimed.projectId,
    workerId: input.workerId,
    attempt,
    outcome: finalOutcome,
    latencyMs: result.latencyMs,
    error: result.error,
    nextAttemptAt,
  });
  logger.warn(
    {
      deliveryId,
      attempt,
      outcome: finalOutcome,
      error: result.error,
      endpoint: redactWebhookUrl(hook.url),
    },
    "webhook attempt network failure"
  );
  return {
    status: finalOutcome,
    attempt,
    latencyMs: result.latencyMs,
    retryDelayMs: nextAttemptAt ? Math.max(0, nextAttemptAt.getTime() - Date.now()) : null,
    error: result.error,
  };
}

/** Count attempt rows for a delivery (observability and tests). */
export async function attemptHistory(db: DbClient, deliveryId: string) {
  const { webhookDeliveryAttempts } = await import("@calder/db");
  return db
    .select()
    .from(webhookDeliveryAttempts)
    .where(eq(webhookDeliveryAttempts.deliveryId, deliveryId));
}

/** Delivery row status, used by tests and the admin inspect endpoint. */
export async function deliveryStatus(db: DbClient, deliveryId: string) {
  const [row] = await db
    .select({
      id: webhookDeliveries.id,
      status: webhookDeliveries.status,
      attemptCount: webhookDeliveries.attemptCount,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  return row ?? null;
}
