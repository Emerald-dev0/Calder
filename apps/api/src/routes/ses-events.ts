import { Hono } from "hono";
import type { Env } from "../app.js";
import { logger } from "@calder/observability";
import { getDb } from "@calder/db";
import {
  applySesEvent,
  parseSesMessage,
  parseSnsEnvelope,
  verifySnsSignature,
  SesEventError,
} from "../lib/ses-events.js";

const sesEvents = new Hono<Env>();

/** Configured SNS topic allowlist (comma-separated). Empty = not configured. */
function allowedTopics(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SES_SNS_TOPIC_ARNS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * POST /v1/ses/events — SES feedback ingress (delivery truth, Phase 1).
 *
 * Deliberately NOT behind API-key auth: SNS cannot send our auth headers.
 * Authenticity is the SNS RSA signature + certificate-origin allowlist +
 * optional topic allowlist. Dedupe and application are idempotent, so SNS
 * redelivery (it retries on non-2xx) is harmless by construction.
 */
sesEvents.post("/events", async (c) => {
  // SNS posts JSON with Content-Type text/plain; always read raw text.
  const raw = await c.req.text();
  const env = parseSnsEnvelope(raw);
  await verifySnsSignature(env);

  const topics = allowedTopics();
  if (topics.length > 0 && !topics.includes(env.TopicArn)) {
    logger.warn({ topicArn: env.TopicArn }, "SNS event from non-allowlisted topic rejected");
    return c.json({ error: { code: "validation_error", message: "Topic not allowed." } }, 400);
  }

  if (env.Type === "SubscriptionConfirmation") {
    // Never auto-confirm without an allowlist: set SES_SNS_TOPIC_ARNS first,
    // otherwise anyone could subscribe this endpoint to their own topic.
    if (topics.length === 0) {
      logger.warn(
        { topicArn: env.TopicArn },
        "SNS subscription confirmation received but SES_SNS_TOPIC_ARNS is not configured"
      );
      return c.json(
        {
          ok: false,
          reason:
            "Subscription not confirmed: SES_SNS_TOPIC_ARNS is not configured. Set it, then re-confirm.",
        },
        200
      );
    }
    const res = await fetch(env.SubscribeURL!, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      logger.error({ status: res.status, topicArn: env.TopicArn }, "SNS subscribe call failed");
      throw new SesEventError("SNS subscribe call failed.", 500);
    }
    logger.info({ topicArn: env.TopicArn }, "SNS subscription confirmed");
    return c.json({ ok: true, confirmed: true });
  }

  if (env.Type === "UnsubscribeConfirmation") {
    logger.info({ topicArn: env.TopicArn }, "SNS unsubscribe confirmation");
    return c.json({ ok: true });
  }

  const msg = parseSesMessage(env);
  const result = await applySesEvent(getDb(), env, msg);
  if (result.unmatched) {
    logger.warn({ sesMessageId: msg.mail.messageId }, "SES event for unknown message id");
  }
  return c.json({ ok: true, ...result });
});

export default sesEvents;
