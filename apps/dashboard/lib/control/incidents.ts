import "../server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { controlIncidents, controlIncidentUpdates, getDb } from "@calder/db";
import { INCIDENT_STATUSES, type IncidentStatus } from "./incident-policy";
export async function incidentRows(status: string | undefined, page: number) {
  const db = getDb();
  const where = INCIDENT_STATUSES.includes(status as IncidentStatus)
    ? eq(controlIncidents.status, status as IncidentStatus)
    : undefined;
  const [totals, rows] = await Promise.all([
    db.select({ value: count() }).from(controlIncidents).where(where),
    db
      .select()
      .from(controlIncidents)
      .where(where)
      .orderBy(desc(controlIncidents.updatedAt), desc(controlIncidents.id))
      .limit(25)
      .offset((page - 1) * 25),
  ]);
  const total = Number(totals[0]?.value ?? 0);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / 25)) };
}
export async function incidentDetail(id: string) {
  const db = getDb();
  const [incident] = await db
    .select()
    .from(controlIncidents)
    .where(eq(controlIncidents.id, id))
    .limit(1);
  if (!incident) return null;
  const updates = await db
    .select()
    .from(controlIncidentUpdates)
    .where(and(eq(controlIncidentUpdates.incidentId, id)))
    .orderBy(desc(controlIncidentUpdates.createdAt))
    .limit(100);
  return { incident, updates };
}
