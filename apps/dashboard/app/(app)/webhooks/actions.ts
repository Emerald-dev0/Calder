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
