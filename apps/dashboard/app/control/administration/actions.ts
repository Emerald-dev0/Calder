"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
  reason: string,
  idempotencyKey: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireControl();
  if (!isFounderRole(ctx.role)) {
    return { ok: false, error: "Founder only." };
  }
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 6 || trimmed.length > 500) {
    return {
      ok: false,
      error: "A reason (≥ 6 characters) is required — it lands in the audit log.",
    };
  }
  if (userId === ctx.user.userId) {
    return { ok: false, error: "You cannot change your own role." };
  }
  if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 255)
    return { ok: false, error: "A valid role-action key is required." };
  const actionKey = idempotencyKey.trim();
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (!target) return { ok: false, error: "User not found." };
    if (isFounderRole(target.platformRole ?? null)) {
      return { ok: false, error: "Founder accounts are managed out-of-band." };
    }
    if (role !== null && !ASSIGNABLE.includes(role)) {
      return { ok: false, error: "Role is not assignable through the UI." };
    }

    const [prior] = await tx
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "user"),
          eq(auditLogs.targetId, userId),
          sql`${auditLogs.metadata}->>'idempotencyKey' = ${actionKey}`
        )
      )
      .limit(1);
    if (prior) {
      const metadata = prior.metadata as Record<string, unknown> | null;
      if (
        prior.actorUserId !== ctx.user.userId ||
        metadata?.to !== role ||
        metadata?.reason !== trimmed
      )
        return { ok: false, error: "Action key was already used for a different role change." };
      return { ok: true };
    }

    if (target.platformRole !== role)
      await tx
        .update(users)
        .set({ platformRole: role, updatedAt: new Date() })
        .where(eq(users.id, userId));
    await tx.insert(auditLogs).values({
      id: `audit_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      actorUserId: ctx.user.userId,
      action:
        target.platformRole === role
          ? "platform_role.noop"
          : role
            ? "platform_role.grant"
            : "platform_role.revoke",
      targetType: "user",
      targetId: userId,
      metadata: {
        email: target.email,
        from: target.platformRole ?? null,
        to: role,
        roleLabel: role ? CONTROL_ROLE_LABEL[role] : null,
        reason: trimmed,
        idempotencyKey: actionKey,
      },
    });
    return { ok: true };
  });
  if (!result.ok) return result;
  revalidatePath("/control/administration");
  revalidatePath("/control/security/admin-access");
  return { ok: true };
}
