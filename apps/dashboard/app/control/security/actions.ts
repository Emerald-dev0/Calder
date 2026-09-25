"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auditLogs, getDb, projectTransports } from "@calder/db";
import { requireSection } from "@/lib/control/guard";

/**
 * M2.5 appeal execution: re-activate a Gmail transport that the abuse watch
 * suspended. Only from `suspended`, never from `revoked` — a revoked account
 * must be re-connected by the owner (the credential itself is dead; only the
 * customer can mint a fresh one). Always audit-logged with the actor.
 */
export async function reactivateGmailTransport(transportId: string): Promise<void> {
  const ctx = await requireSection("security");
  const db = getDb();
  const [row] = await db
    .select({
      id: projectTransports.id,
      status: projectTransports.status,
      projectId: projectTransports.projectId,
      label: projectTransports.label,
    })
    .from(projectTransports)
    .where(eq(projectTransports.id, transportId))
    .limit(1);
  if (!row) throw new Error("Transport not found.");
  if (row.status === "revoked") {
    throw new Error(
      "OAuth grant was revoked — the account owner must reconnect from the dashboard."
    );
  }
  if (row.status !== "suspended") throw new Error("Transport is not suspended.");

  const updated = await db
    .update(projectTransports)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(eq(projectTransports.id, transportId), eq(projectTransports.status, "suspended")))
    .returning({ id: projectTransports.id });
  if (updated.length === 0) throw new Error("Transport changed state concurrently.");

  await db.insert(auditLogs).values({
    id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    projectId: row.projectId,
    actorUserId: ctx.user.userId,
    action: "transport.gmail_reactivated",
    targetType: "project_transport",
    targetId: row.id,
    metadata: { label: row.label, appealFrom: ctx.email },
  });
  revalidatePath("/control/security");
}
