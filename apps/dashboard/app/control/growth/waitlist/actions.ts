"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, waitlistSignups } from "@calder/db";
import { getDb } from "@calder/db";
import { requireControl } from "@/lib/control/guard";
import { READ_ONLY_ROLES } from "@/lib/control/roles";

/**
 * Control Plane waitlist actions. Operator-gated (no section finer than
 * "growth" today), audit-logged, and never available to read-only roles.
 * Analysts observe; operators act.
 */

async function requireOperator() {
  const ctx = await requireControl();
  if ((READ_ONLY_ROLES as string[]).includes(ctx.role)) {
    throw new Error("Read-only role: analysts cannot modify the waitlist.");
  }
  return ctx;
}

async function audit(
  actorUserId: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>
) {
  const db = getDb();
  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId,
      action,
      targetType: "waitlist_signup",
      targetId,
      metadata,
    });
  } catch {
    // Audit must never break the operation it records.
  }
}

export async function setWaitlistStatus(id: string, status: "waiting" | "invited" | "contacted" | "removed") {
  const ctx = await requireOperator();
  const db = getDb();
  const [person] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.id, id)).limit(1);
  if (!person) return;
  const now = new Date();
  await db
    .update(waitlistSignups)
    .set({
      status,
      invitedAt: status === "invited" ? (person.invitedAt ?? now) : person.invitedAt,
      contactedAt: status === "contacted" ? (person.contactedAt ?? now) : person.contactedAt,
    })
    .where(eq(waitlistSignups.id, id));
  await audit(ctx.user.userId, `waitlist.status.${status}`, id, { from: person.status, to: status, email: person.email });
  revalidatePath("/control/growth/waitlist");
  revalidatePath(`/control/growth/waitlist/${id}`);
}

export async function addWaitlistTag(id: string, rawTag: string) {
  const ctx = await requireOperator();
  const tag = rawTag.trim().toLowerCase().slice(0, 40);
  if (!tag) return;
  const db = getDb();
  const [person] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.id, id)).limit(1);
  if (!person) return;
  const tags = new Set(person.tags ?? []);
  tags.add(tag);
  await db.update(waitlistSignups).set({ tags: [...tags] }).where(eq(waitlistSignups.id, id));
  await audit(ctx.user.userId, "waitlist.tag.add", id, { tag });
  revalidatePath(`/control/growth/waitlist/${id}`);
}

export async function removeWaitlistTag(id: string, tag: string) {
  const ctx = await requireOperator();
  const db = getDb();
  const [person] = await db.select().from(waitlistSignups).where(eq(waitlistSignups.id, id)).limit(1);
  if (!person) return;
  const tags = (person.tags ?? []).filter((t) => t !== tag);
  await db.update(waitlistSignups).set({ tags }).where(eq(waitlistSignups.id, id));
  await audit(ctx.user.userId, "waitlist.tag.remove", id, { tag });
  revalidatePath(`/control/growth/waitlist/${id}`);
}

export async function setWaitlistNote(id: string, note: string) {
  const ctx = await requireOperator();
  const db = getDb();
  await db
    .update(waitlistSignups)
    .set({ note: note.trim().slice(0, 4000) || null })
    .where(eq(waitlistSignups.id, id));
  await audit(ctx.user.userId, "waitlist.note.set", id, { length: note.trim().length });
  revalidatePath(`/control/growth/waitlist/${id}`);
}
