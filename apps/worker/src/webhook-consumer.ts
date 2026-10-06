import { lookup } from "node:dns/promises";
import { createQueue, type QueueJob } from "@calder/queue";
import { isPublicIpAddress, isPublicWebhookUrl } from "@calder/validation";
import { decryptSecret } from "@calder/auth";
import { logger } from "@calder/observability";
import { createHmac, timingSafeEqual } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { WEBHOOK_SECRET_CONTEXT, WEBHOOK_MAX_ATTEMPTS, nextRetryDelayMs } from "@calder/db";

// Preserve the worker test/export contract while sharing the registry's
// write-time SSRF rule with API and dashboard callers.
export { isPublicWebhookUrl } from "@calder/validation";

/** User-facing delivery budget per attempt. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** Sign exactly once over the exact body bytes that will be sent. */
export function buildSignatureHeader(secret: string, timestampSec: number, body: string): string {
  const sig = createHmac("sha256", secret).update(`${timestampSec}.${body}`, "utf8").digest("hex");
  return `t=${timestampSec},v1=${sig}`;
}

/**
 * Defense-in-depth endpoint validation (the registry guards at write, the
 * consumer re-checks at send): the shared https/public-host rule is applied
 * before a fresh DNS resolution, which rejects private answers immediately
 * before delivery.
 */
function privateAddress(address: string): boolean {
  return !isPublicIpAddress(address);
}

/**
 * Resolve the hostname once immediately before delivery. The selected address
 * is passed to the HTTPS client's lookup hook below, so the connection cannot
 * perform a second DNS lookup and be redirected by a rebinding response.
 */
export async function resolvePublicWebhookAddress(
  url: string
): Promise<{ address: string; family: 4 | 6 } | null> {
  if (!isPublicWebhookUrl(url)) return null;
  try {
    const host = new URL(url).hostname;
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) {
      return null;
    }
    const selected = addresses[0];
    return selected && (selected.family === 4 || selected.family === 6)
      ? { address: selected.address, family: selected.family }
      : null;
  } catch {
    return null;
  }
}

export async function isPublicWebhookUrlResolved(url: string): Promise<boolean> {
  return (await resolvePublicWebhookAddress(url)) !== null;
}

async function postPinnedHttps(
  url: string,
  address: { address: string; family: 4 | 6 },
  headers: Record<string, string>,
  body: string
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      parsed,
      {
        method: "POST",
        headers,
        // Preserve the original URL/SNI while pinning the socket lookup to
        // the address already checked by resolvePublicWebhookAddress.
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        res.once("end", () => resolve({ ok: status >= 200 && status < 300, status }));
      }
    );
    const timer = setTimeout(() => req.destroy(new Error("delivery_timeout")), DELIVERY_TIMEOUT_MS);
    req.once("error", reject);
    req.once("close", () => clearTimeout(timer));
    req.end(body);
  });
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
  const { and, eq } = await import("drizzle-orm");
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
    .where(and(eq(webhooks.id, delivery.webhookId), eq(webhooks.projectId, delivery.projectId)))
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
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.projectId, delivery.projectId)
        )
      );
    if (!exhausted) throw new Error(message); // queue retries per its own backoff
    logger.error({ deliveryId, attempt }, `webhook delivery failed permanently: ${message}`);
  };

  if (!hook) return fail("webhook was deleted before delivery", true);
  if (!hook.enabled) return fail("webhook was disabled before delivery", true);
  const resolvedAddress = await resolvePublicWebhookAddress(hook.url);
  if (!resolvedAddress) {
    return fail("endpoint URL refused by SSRF guard", true);
  }

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
    const res = await postPinnedHttps(
      hook.url,
      resolvedAddress,
      {
        "content-type": "application/json",
        "user-agent": "Calder-Webhooks/1.0",
        "webhook-id": deliveryId,
        "webhook-signature": buildSignatureHeader(secret, ts, body),
      },
      body
    );
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
        .where(
          and(
            eq(webhookDeliveries.id, deliveryId),
            eq(webhookDeliveries.projectId, delivery.projectId)
          )
        );
      logger.info({ deliveryId, latencyMs, status: res.status }, "webhook delivered");
      return;
    }
    await fail(`endpoint answered HTTP ${res.status}`, false, {
      latencyMs,
      responseStatus: res.status,
    });
  } catch (err) {
    // Do not persist arbitrary TLS/socket/provider exception text in delivery
    // records. It can contain host details or credentials from an upstream
    // stack; callers only need a stable retry classification.
    const timedOut = err instanceof Error && err.message === "delivery_timeout";
    const msg = timedOut
      ? `endpoint timed out after ${DELIVERY_TIMEOUT_MS}ms`
      : "endpoint unreachable";
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
