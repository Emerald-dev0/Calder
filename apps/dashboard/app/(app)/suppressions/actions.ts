"use server";

import { and, eq } from "drizzle-orm";
import { getDb, suppressions } from "@calder/db";
import { assertProjectAccess } from "../onboarding/actions";

/** Manual suppression: refuse a recipient before a bad send ever happens. */
export async function addSuppression(projectId: string, email: string, reason: string) {
  await assertProjectAccess(projectId);
  const clean = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error("Enter a valid email address.");
  const why = reason.trim() || "manual";
  const db = getDb();
  const id = `sup_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  // Upsert-free: unique (project, email); re-adding an existing row is a no-op.
  await db
    .insert(suppressions)
    .values({ id, projectId, email: clean, reason: why })
    .onConflictDoNothing({ target: [suppressions.projectId, suppressions.email] });
  return { ok: true as const };
}

/** Remove a suppression (e.g. recipient fixed their mailbox). */
export async function removeSuppression(projectId: string, id: string) {
  await assertProjectAccess(projectId);
  const db = getDb();
  const deleted = await db
    .delete(suppressions)
    .where(and(eq(suppressions.id, id), eq(suppressions.projectId, projectId)))
    .returning({ id: suppressions.id });
  if (deleted.length === 0) throw new Error("Suppression not found.");
  return { ok: true as const };
}
