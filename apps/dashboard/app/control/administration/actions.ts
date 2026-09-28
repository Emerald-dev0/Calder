"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditLogs, users, type PlatformRole } from "@calder/db";
import { getDb } from "@calder/db";
import { requireControl } from "@/lib/control/guard";
import { CONTROL_ROLE_LABEL, isFounderRole } from "@/lib/control/roles";

const ASSIGNABLE: PlatformRole[] = [
  "platform_admin",
  "support",
  "billing",
  "infrastructure",
  "security",
  "analyst",
];

/**
 * Grant or revoke a platform role. FOUNDER-ONLY, by design and by code:
 * nobody promotes themselves, and founder accounts cannot be touched
 * through the UI at all — founder management is an out-of-band,
 * SQL-level operation (see docs/CONTROL-PLANE.md).
 */
export async function setPlatformRole(
  userId: string,
  role: PlatformRole | null,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireControl();
  if (!isFounderRole(ctx.role)) {
    return { ok: false, error: "Founder only." };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 6) {
    return {
      ok: false,
      error: "A reason (≥ 6 characters) is required — it lands in the audit log.",
    };
  }
  if (userId === ctx.user.userId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { ok: false, error: "User not found." };
  if (isFounderRole(target.platformRole ?? null)) {
    return { ok: false, error: "Founder accounts are managed out-of-band." };
  }
  if (role !== null && !ASSIGNABLE.includes(role)) {
    return { ok: false, error: "Role is not assignable through the UI." };
  }

  await db
    .update(users)
    .set({ platformRole: role, updatedAt: new Date() })
    .where(eq(users.id, userId));
  try {
    await db.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId: ctx.user.userId,
      action: role ? "platform_role.grant" : "platform_role.revoke",
      targetType: "user",
      targetId: userId,
      metadata: {
        email: target.email,
        from: target.platformRole ?? null,
        to: role,
        roleLabel: role ? CONTROL_ROLE_LABEL[role] : null,
        reason: trimmed,
      },
    });
  } catch {
    // Audit must never break the operation it records.
  }
  revalidatePath("/control/administration");
  revalidatePath("/control/security/admin-access");
  return { ok: true };
}
