"use server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, controlIncidents, controlIncidentUpdates, getDb } from "@calder/db";
import { requireSection } from "@/lib/control/guard";
import {
  canManageIncidents,
  canTransitionIncident,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type IncidentStatus,
} from "@/lib/control/incident-policy";

async function operator() {
  const ctx = await requireSection("observability");
  if (!canManageIncidents(ctx.role))
    throw new Error("Incident changes require founder, platform admin or infrastructure role.");
  return ctx;
}
function validId(id: string) {
  return (
    typeof id === "string" &&
    /^inc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  );
}
export async function createIncident(input: {
  id: string;
  title: string;
  summary: string;
  severity: string;
}) {
  const ctx = await operator();
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  if (
    !validId(input.id) ||
    title.length < 6 ||
    title.length > 200 ||
    summary.length < 6 ||
    summary.length > 4000 ||
    !INCIDENT_SEVERITIES.includes(input.severity as (typeof INCIDENT_SEVERITIES)[number])
  )
    throw new Error(
      "Valid incident ID, title (6–200), summary (6–4000), and severity are required."
    );
  await getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(controlIncidents)
      .values({
        id: input.id,
        title,
        summary,
        severity: input.severity as (typeof INCIDENT_SEVERITIES)[number],
        createdBy: ctx.user.userId,
      })
      .onConflictDoNothing()
      .returning({ id: controlIncidents.id });
    if (!inserted.length) {
      const [prior] = await tx
        .select()
        .from(controlIncidents)
        .where(eq(controlIncidents.id, input.id))
        .limit(1);
      if (
        !prior ||
        prior.createdBy !== ctx.user.userId ||
        prior.title !== title ||
        prior.summary !== summary ||
        prior.severity !== input.severity
      )
        throw new Error("Incident ID was already used for another request.");
      return;
    }
    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID()}`,
      actorUserId: ctx.user.userId,
      action: "platform.internal.incident.created",
      targetType: "control_incident",
      targetId: input.id,
      metadata: { severity: input.severity, status: "investigating" },
    });
  });
  revalidatePath("/control/observability/incidents");
  return { id: input.id };
}
export async function updateIncident(input: {
  id: string;
  updateId: string;
  revision: number;
  status: string;
  message: string;
}) {
  const ctx = await operator();
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (
    !validId(input.id) ||
    !validId(input.updateId) ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !INCIDENT_STATUSES.includes(input.status as IncidentStatus) ||
    message.length < 6 ||
    message.length > 4000
  )
    throw new Error("Valid incident update, revision, status and note (6–4000) are required.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(controlIncidents)
      .where(eq(controlIncidents.id, input.id))
      .limit(1)
      .for("update");
    if (!row) throw new Error("Incident not found.");
    const [prior] = await tx
      .select()
      .from(controlIncidentUpdates)
      .where(eq(controlIncidentUpdates.id, input.updateId))
      .limit(1);
    if (prior) {
      if (
        prior.incidentId !== input.id ||
        prior.actorUserId !== ctx.user.userId ||
        prior.toStatus !== input.status ||
        prior.message !== message
      )
        throw new Error("Update ID was already used for another request.");
      return;
    }
    if (row.revision !== input.revision)
      throw new Error("Incident changed. Refresh before submitting another update.");
    if (!canTransitionIncident(row.status, input.status as IncidentStatus))
      throw new Error("Unsupported incident transition. Resolved incidents cannot be changed.");
    const now = new Date();
    await tx.insert(controlIncidentUpdates).values({
      id: input.updateId,
      incidentId: input.id,
      actorUserId: ctx.user.userId,
      fromStatus: row.status,
      toStatus: input.status as IncidentStatus,
      message,
    });
    await tx
      .update(controlIncidents)
      .set({
        status: input.status as IncidentStatus,
        revision: row.revision + 1,
        updatedAt: now,
        resolvedAt: input.status === "resolved" ? now : null,
      })
      .where(eq(controlIncidents.id, input.id));
    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID()}`,
      actorUserId: ctx.user.userId,
      action: "platform.internal.incident.updated",
      targetType: "control_incident",
      targetId: input.id,
      metadata: {
        from: row.status,
        to: input.status,
        revision: row.revision + 1,
        updateId: input.updateId,
      },
    });
  });
  revalidatePath("/control/observability/incidents");
  revalidatePath(`/control/observability/incidents/${input.id}`);
}
