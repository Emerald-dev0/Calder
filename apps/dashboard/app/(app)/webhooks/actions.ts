"use server";

import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb, webhooks } from "@calder/db";
import { getTenantContext } from "../../../lib/auth";
import { encryptSecret, newWebhookSecret } from "./crypto";
import { WEBHOOK_EVENTS } from "./events";

function rid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function assertProject(projectId: string) {
  const ctx = await getTenantContext();
  const ids = new Set(ctx.memberships.flatMap((m) => m.projects.map((p) => p.id)));
  if (!ids.has(projectId)) throw new Error("Project not found.");
}

export async function listWebhooks(projectId: string) {
  await assertProject(projectId);
  const db = getDb();
  const rows = await db
    .select({
      id: webhooks.id,
      url: webhooks.url,
      events: webhooks.events,
      enabled: webhooks.enabled,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function createWebhook(projectId: string, url: string, events: string[]) {
  await assertProject(projectId);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid https URL.");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("Endpoint must be https (localhost allowed for testing).");
  }
  const clean = events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (clean.length === 0) throw new Error("Select at least one event.");
  const secret = newWebhookSecret();
  const db = getDb();
  const id = rid("wh");
  await db.insert(webhooks).values({
    id,
    projectId,
    url: parsed.toString(),
    secret: encryptSecret(secret),
    events: clean,
    enabled: true,
  });
  // Raw secret shown ONCE.
  return { id, secret };
}

export async function setWebhookEnabled(projectId: string, webhookId: string, enabled: boolean) {
  await assertProject(projectId);
  const db = getDb();
  await db
    .update(webhooks)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.projectId, projectId)));
  return { ok: true as const };
}

/** Last N deliveries for one endpoint (no payloads — they can carry PII). */
export async function listWebhookDeliveries(projectId: string, webhookId: string, limit = 15) {
  await assertProject(projectId);
  const db = getDb();
  const { webhookDeliveries } = await import("@calder/db");
  const { desc } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attemptCount: webhookDeliveries.attemptCount,
      latencyMs: webhookDeliveries.latencyMs,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      deliveredAt: webhookDeliveries.deliveredAt,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.projectId, projectId))
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Explicit replay (M3.2): NEW pending delivery carrying the same event data,
 * targeting THIS endpoint only, queued immediately. Replays are deliberate —
 * receivers dedupe on the business id inside data (e.g. emailId).
 */
export async function replayDelivery(projectId: string, webhookId: string, deliveryId: string) {
  await assertProject(projectId);
  const db = getDb();
  const { webhookDeliveries, enqueueWebhookDeliveries } = await import("@calder/db");
  const [src] = await db
    .select({ event: webhookDeliveries.event, payload: webhookDeliveries.payload })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.webhookId, webhookId),
        eq(webhookDeliveries.projectId, projectId)
      )
    )
    .limit(1);
  if (!src) throw new Error("Delivery not found.");
  const data = ((src.payload as { data?: Record<string, unknown> })?.data ?? {}) as Record<
    string,
    unknown
  >;
  const created = await enqueueWebhookDeliveries(db, {
    projectId,
    event: src.event,
    data,
    webhookId,
  });
  if (created === 0) throw new Error("Endpoint disabled or unsubscribed.");
  return { ok: true as const };
}

/** Rotate the signing secret. Shown ONCE; the old secret stops signing immediately. */
export async function rotateWebhookSecret(projectId: string, webhookId: string) {
  await assertProject(projectId);
  const db = getDb();
  const secret = newWebhookSecret();
  const updated = await db
    .update(webhooks)
    .set({ secret: encryptSecret(secret), updatedAt: new Date() })
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.projectId, projectId)))
    .returning({ id: webhooks.id });
  if (updated.length === 0) throw new Error("Endpoint not found.");
  return { secret };
}
