import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, emails, emailEvents, providerEvents, suppressions } from "@calder/db";
import type { Env } from "../app.js";
import { parseSnsEnvelope, validSnsUrl, verifySnsSignature } from "../lib/sns.js";

const sesEvents = new Hono<Env>();
const allowedTopics = () => new Set((process.env.SES_SNS_TOPIC_ARNS ?? "").split(",").map((v) => v.trim()).filter(Boolean));

function jsonMessage(envelope: { Message: string }): Record<string, unknown> | null {
  try {
    const value = JSON.parse(envelope.Message);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Public SNS endpoint. It intentionally authenticates before touching tenant data. */
sesEvents.post("/", async (c) => {
  const envelope = parseSnsEnvelope(await c.req.json().catch(() => null));
  if (!envelope || !(await verifySnsSignature(envelope))) {
    return c.json({ error: { code: "invalid_sns_signature", message: "SNS signature rejected" } }, 400);
  }
  if (envelope.TopicArn && allowedTopics().size && !allowedTopics().has(envelope.TopicArn)) {
    return c.json({ error: { code: "unknown_sns_topic", message: "SNS topic is not configured" } }, 403);
  }
  if (envelope.Type === "SubscriptionConfirmation") {
    // Do not follow arbitrary URLs. The certificate was authenticated and the topic is allowlisted.
    if (!envelope.SubscribeURL || !validSnsUrl(envelope.SubscribeURL, envelope.TopicArn) || !envelope.TopicArn || !allowedTopics().has(envelope.TopicArn)) {
      return c.json({ error: { code: "subscription_not_allowed", message: "Topic is not allowlisted" } }, 403);
    }
    const response = await fetch(envelope.SubscribeURL);
    if (!response.ok) return c.json({ error: { code: "subscription_confirmation_failed", message: "SNS confirmation failed" } }, 502);
    return c.json({ data: { accepted: true, confirmed: true } });
  }
  if (envelope.Type !== "Notification") return c.json({ data: { accepted: true } });

  const message = jsonMessage(envelope);
  if (!message) return c.json({ error: { code: "invalid_ses_message", message: "SES notification was not JSON" } }, 400);
  const db = getDb();
  const inserted = await db.insert(providerEvents).values({
    id: `pev_${randomUUID().replaceAll("-", "")}`,
    messageId: envelope.MessageId,
    topicArn: envelope.TopicArn,
    eventType: String(message.eventType ?? "unknown"),
    payload: message,
  }).onConflictDoNothing({ target: providerEvents.messageId }).returning({ id: providerEvents.id });
  if (inserted.length === 0) return c.json({ data: { accepted: true, duplicate: true } });

  await applySesEvent(message);
  return c.json({ data: { accepted: true } });
});

async function applySesEvent(message: Record<string, unknown>): Promise<void> {
  const mail = (message.mail ?? {}) as Record<string, unknown>;
  const providerMessageId = typeof mail.messageId === "string" ? mail.messageId : null;
  if (!providerMessageId) return;
  const eventType = String(message.eventType ?? "");
  const status = eventType === "Delivery" ? "delivered" : eventType === "Bounce" ? "bounced" : eventType === "Complaint" ? "complained" : null;
  if (!status) return;
  const db = getDb();
  const rows = await db.select({ id: emails.id, projectId: emails.projectId, to: emails.to }).from(emails).where(eq(emails.providerMessageId, providerMessageId));
  for (const row of rows) {
    await db.update(emails).set({ status, updatedAt: new Date() }).where(eq(emails.id, row.id));
    await db.insert(emailEvents).values({ id: `evt_${randomUUID().replaceAll("-", "")}`, emailId: row.id, projectId: row.projectId, type: status, data: { provider_message_id: providerMessageId } });
    if (status === "bounced" || status === "complained") {
      await db.insert(suppressions).values({ id: `sup_${randomUUID().replaceAll("-", "")}`, projectId: row.projectId, email: row.to, reason: status === "bounced" ? "bounce" : "complaint" }).onConflictDoNothing();
    }
  }
}

export default sesEvents;
