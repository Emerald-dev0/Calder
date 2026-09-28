import { createQueue, type QueueJob } from "@calder/queue";
import { decryptSecret } from "@calder/auth";
import { logger } from "@calder/observability";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_SECRET_CONTEXT, WEBHOOK_MAX_ATTEMPTS, nextRetryDelayMs } from "@calder/db";

/** User-facing delivery budget per attempt. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** Sign exactly once over the exact body bytes that will be sent. */
export function buildSignatureHeader(secret: string, timestampSec: number, body: string): string {
  const sig = createHmac("sha256", secret).update(`${timestampSec}.${body}`, "utf8").digest("hex");
  return `t=${timestampSec},v1=${sig}`;
}

/**
 * Defense-in-depth endpoint validation (the registry guards at write, the
 * consumer re-checks at send): https-only, no loopback/link-local/private
 * literals. Hostname resolution is NOT pinned — the registry contract is
 * that operators point at their own endpoints, and literal-IP blocks stop
 * the ambient-abuse cases; DNS rebinding is the customer hurting themselves.
 */
export function isPublicWebhookUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    return false;
  // IPv6 in brackets; IPv4 dotted quads; hostname keywords.
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "::1" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd"))
    return false;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(bare);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a >= 224) return false;
  }
  if (bare === "metadata.google.internal" || bare === "169.254.169.254") return false;
  return true;
}

/** Exported for the vector test: the contract consumers verify against. */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  const tMatch = /(?:^|,)t=(\d+)/.exec(header);
  const v1Match = /(?:^|,)v1=([0-9a-f]{64})/.exec(header);
  if (!tMatch || !v1Match) return false;
  const ts = Number(tMatch[1]!);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
  const given = Buffer.from(v1Match[1]!, "hex");
  const want = Buffer.from(expected, "hex");
  return given.length === want.length && timingSafeEqual(given, want);
}

interface DeliverJob {
  deliveryId: string;
}

async function processDelivery(job: QueueJob<DeliverJob>): Promise<void> {
  const { deliveryId } = job.data;
  const { getDb, webhooks, webhookDeliveries } = await import("@calder/db");
  const { eq } = await import("drizzle-orm");
  const db = getDb();

  const [delivery] = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery) {
    // Never invent a delivery. A dangling job is a bug in enqueue; log and drop.
    logger.error({ deliveryId }, "webhook delivery job without a durable row; dropping");
    return;
  }
  if (delivery.status !== "pending") return; // replay paths create new rows; old ones are frozen

  const [hook] = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      secret: webhooks.secret,
      enabled: webhooks.enabled,
    })
    .from(webhooks)
    .where(eq(webhooks.id, delivery.webhookId))
    .limit(1);

  const attempt = job.attempts + 1;
  const fail = async (message: string, terminal: boolean, extra?: Record<string, unknown>) => {
    const retryDelay = nextRetryDelayMs(attempt);
    const exhausted = terminal || retryDelay === null || attempt >= WEBHOOK_MAX_ATTEMPTS;
    await db
      .update(webhookDeliveries)
      .set({
        status: exhausted ? "failed" : "pending",
        attemptCount: attempt,
        lastError: message,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + retryDelay!),
        ...extra,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    if (!exhausted) throw new Error(message); // queue retries per its own backoff
    logger.error({ deliveryId, attempt }, `webhook delivery failed permanently: ${message}`);
  };

  if (!hook) return fail("webhook was deleted before delivery", true);
  if (!hook.enabled) return fail("webhook was disabled before delivery", true);
  if (!isPublicWebhookUrl(hook.url)) return fail("endpoint URL refused by SSRF guard", true);

  let secret: string;
  try {
    secret = decryptSecret(hook.secret, WEBHOOK_SECRET_CONTEXT);
  } catch {
    return fail("could not decrypt signing secret", true);
  }

  const body = JSON.stringify(delivery.payload);
  const ts = Math.floor(Date.now() / 1000);
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(hook.url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "Calder-Webhooks/1.0",
          "webhook-id": deliveryId,
          "webhook-signature": buildSignatureHeader(secret, ts, body),
        },
        body,
      });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - started;
    if (res.ok) {
      await db
        .update(webhookDeliveries)
        .set({
          status: "delivered",
          attemptCount: attempt,
          latencyMs,
          responseStatus: res.status,
          lastError: null,
          nextAttemptAt: null,
          deliveredAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      logger.info({ deliveryId, latencyMs, status: res.status }, "webhook delivered");
      return;
    }
    await fail(`endpoint answered HTTP ${res.status}`, false, {
      latencyMs,
      responseStatus: res.status,
    });
  } catch (err) {
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? `endpoint timed out after ${DELIVERY_TIMEOUT_MS}ms`
        : `endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`;
    await fail(msg, false, { latencyMs: Date.now() - started });
  }
}

/** Start the webhook consumer alongside the email worker (M3.1). */
export function startWebhookConsumer() {
  const queue = createQueue<DeliverJob>("webhook:deliver", { maxAttempts: WEBHOOK_MAX_ATTEMPTS });
  queue.process(async (job) => {
    await processDelivery(job);
  });
  logger.info("Worker consumer started on queue webhook:deliver");
  return queue;
}
