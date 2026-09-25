import { and, eq, sql } from "drizzle-orm";
import { usageRecords } from "./schema/billing.js";
import type { DbClient } from "./client.js";

function monthBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** Idempotent monthly metering primitive. The unique migration makes increments race-safe. */
export async function recordUsage(db: DbClient, input: { organizationId: string; projectId: string; metric: string; quantity?: number; now?: Date }) {
  const { start, end } = monthBounds(input.now);
  const id = `use_${input.organizationId}_${input.projectId}_${input.metric}_${start.toISOString().slice(0, 7)}`.replace(/[^a-zA-Z0-9_]/g, "_");
  await db.insert(usageRecords).values({ id, organizationId: input.organizationId, projectId: input.projectId, metric: input.metric, quantity: input.quantity ?? 1, periodStart: start, periodEnd: end }).onConflictDoUpdate({ target: usageRecords.id, set: { quantity: sql`${usageRecords.quantity} + ${input.quantity ?? 1}` } });
  return { id, periodStart: start, periodEnd: end };
}
