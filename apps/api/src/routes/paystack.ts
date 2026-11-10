import { Hono } from "hono";
import type { Env } from "../app.js";
import { getDb } from "@calder/db";
import { logger } from "@calder/observability";
import { BillingError, handlePaystackWebhook } from "../services/billing.js";

const paystack = new Hono<Env>();

/**
 * POST /v1/paystack/webhook
 *
 * Paystack signs the raw body with HMAC-SHA512 using the secret key. The route
 * is deliberately unauthenticated (Paystack cannot hold an API key) but grants
 * nothing without a valid signature plus a server-side transaction verify.
 */
paystack.post("/webhook", async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header("x-paystack-signature");
  try {
    const result = await handlePaystackWebhook(getDb(), raw, signature);
    return c.json(result, result.duplicate ? 200 : 200);
  } catch (err) {
    if (err instanceof BillingError) {
      logger.warn({ code: err.code }, "paystack webhook refused");
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 401);
    }
    logger.error({ err }, "paystack webhook processing failed");
    // Non-2xx makes Paystack retry, which is what we want for a transient
    // database/provider failure. The receipt row remains unprocessed.
    return c.json(
      { error: { code: "webhook_failed", message: "Webhook could not be processed" } },
      500
    );
  }
});

export default paystack;
