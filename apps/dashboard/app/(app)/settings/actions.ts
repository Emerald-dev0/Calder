"use server";

import { randomBytes, createHash } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  getDb,
  organizations,
  organizationMembers,
  orgInvitations,
  users,
  auditLogs,
} from "@calder/db";

/** Immutable audit trail for team lifecycle events. Fire-and-forget safe. */
async function audit(
  db: ReturnType<typeof getDb>,
  entry: {
    organizationId: string;
    actorUserId?: string;
    action: string;
    targetType?: string;
    targetId?: string;
  }
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: rid("audit"),
      organizationId: entry.organizationId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
    });
  } catch {
    // Audit must never break the operation it records.
  }
}
import { getTenantContext } from "../../../lib/auth";
import { getConfig } from "@calder/config";

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

type Role = "owner" | "admin" | "member";

/** Caller's role in the org, or null for non-members. */
async function callerRole(userId: string, orgId: string): Promise<Role | null> {
  const db = getDb();
  const rows = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId))
    )
    .limit(1);
  return (rows[0]?.role as Role | undefined) ?? null;
}

async function requireManager(orgId: string) {
  const ctx = await getTenantContext();
  const role = await callerRole(ctx.user.userId, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only organization owners or admins can manage the team.");
  }
  return ctx;
}

export async function getTeam(orgId: string) {
  const ctx = await getTenantContext();
  const role = await callerRole(ctx.user.userId, orgId);
  if (!role) throw new Error("Organization not found.");
  const db = getDb();
  const members = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      email: users.email,
      name: users.name,
      role: organizationMembers.role,
      createdAt: organizationMembers.createdAt,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));
  const invites = await db
    .select()
    .from(orgInvitations)
    .where(eq(orgInvitations.organizationId, orgId));
  const org = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return {
    organization: org[0] ?? null,
    callerRole: role,
    callerUserId: ctx.user.userId,
    members: members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      acceptedAt: i.acceptedAt?.toISOString() ?? null,
      expiresAt: i.expiresAt.toISOString(),
      expired: i.expiresAt < new Date(),
    })),
  };
}

export async function inviteMember(orgId: string, email: string, role: Role) {
  const inviter = await requireManager(orgId);
  const clean = email.toLowerCase().trim();
  if (!clean.includes("@")) throw new Error("Enter a valid email address.");
  if (role !== "admin" && role !== "member") {
    throw new Error("New invites are member or admin only, ownership transfers separately.");
  }
  const db = getDb();
  // Already a member? Say so instead of double-inviting.
  const member = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, clean))
    .limit(1);
  if (member[0]) {
    const existing = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, member[0].id)
        )
      )
      .limit(1);
    if (existing[0]) throw new Error("That address is already on the team.");
  }
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  await db.insert(orgInvitations).values({
    id: rid("inv"),
    organizationId: orgId,
    email: clean,
    role,
    tokenHash,
    invitedBy: (await getTenantContext()).user.userId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const appUrl = getConfig().APP_URL.replace(/\/$/, "");
  await audit(db, {
    organizationId: orgId,
    actorUserId: inviter.user.userId,
    action: "member.invited",
    targetType: "invitation",
  });
  return { inviteLink: `${appUrl}/invite/${rawToken}` };
}

export async function updateMemberRole(orgId: string, membershipId: string, role: Role) {
  const ctx = await getTenantContext();
  const caller = await callerRole(ctx.user.userId, orgId);
  if (caller !== "owner") throw new Error("Only owners can change roles.");
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error("Invalid role.");
  }
  const db = getDb();
  // Never demote/remove the last owner, an org without an owner is orphaned.
  if (role !== "owner") {
    const owners = await db
      .select({ id: organizationMembers.id, userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, "owner"))
      );
    const target = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.id, membershipId))
      .limit(1);
    if (target[0]?.organizationId === orgId && target[0]?.role === "owner" && owners.length <= 1) {
      throw new Error("Cannot demote the last owner, transfer ownership first.");
    }
  }
  await db
    .update(organizationMembers)
    .set({ role })
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    );
  await audit(db, {
    organizationId: orgId,
    actorUserId: ctx.user.userId,
    action: "member.role_changed",
    targetType: "membership",
    targetId: membershipId,
  });
  return { ok: true as const };
}

export async function removeMember(orgId: string, membershipId: string) {
  const ctx = await getTenantContext();
  const caller = await callerRole(ctx.user.userId, orgId);
  if (caller !== "owner") throw new Error("Only owners can remove members.");
  const db = getDb();
  const target = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.id, membershipId))
    .limit(1);
  if (!target[0] || target[0].organizationId !== orgId) throw new Error("Member not found.");
  if (target[0].role === "owner") {
    const owners = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, "owner"))
      );
    if (owners.length <= 1) throw new Error("Cannot remove the last owner.");
  }
  if (target[0].userId === ctx.user.userId) {
    throw new Error("You can't remove yourself, ask another owner.");
  }
  await db.delete(organizationMembers).where(eq(organizationMembers.id, membershipId));
  await audit(db, {
    organizationId: orgId,
    actorUserId: ctx.user.userId,
    action: "member.removed",
    targetType: "membership",
    targetId: membershipId,
  });
  return { ok: true as const };
}

/**
 * Public preview for /invite/[token]: resolves the org name + state without
 * authentication (the 256-bit token IS the capability). Never exposes member
 * lists, emails beyond the invitee's own, or raw tokens.
 */
export async function getInvitePreview(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return { state: "invalid" as const };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = getDb();
  const rows = await db
    .select({ invite: orgInvitations, orgName: organizations.name })
    .from(orgInvitations)
    .innerJoin(organizations, eq(orgInvitations.organizationId, organizations.id))
    .where(eq(orgInvitations.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return { state: "invalid" as const };
  if (row.invite.acceptedAt) return { state: "accepted" as const, orgName: row.orgName };
  if (row.invite.expiresAt < new Date()) return { state: "expired" as const, orgName: row.orgName };
  return { state: "valid" as const, orgName: row.orgName, email: row.invite.email };
}

export async function revokeInvite(orgId: string, inviteId: string) {
  await requireManager(orgId);
  const db = getDb();
  await db
    .delete(orgInvitations)
    .where(and(eq(orgInvitations.id, inviteId), eq(orgInvitations.organizationId, orgId)));
  return { ok: true as const };
}

// ---------- M6.1: session inventory + sign-out controls --------------------

export async function listMySessions() {
  const ctx = await getTenantContext();
  const { listLiveSessions } = await import("@calder/auth");
  const rows = await listLiveSessions(ctx.user.userId);
  return rows.map((s) => ({
    id: s.id,
    current: s.id === ctx.user.sessionId,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt?.toISOString() ?? null,
    expiresAt: s.expiresAt.toISOString(),
  }));
}

export async function revokeSessionById(sessionId: string) {
  const ctx = await getTenantContext();
  const { revokeOwnSession } = await import("@calder/auth");
  const ok = await revokeOwnSession(ctx.user.userId, sessionId);
  if (!ok) throw new Error("Session not found.");
  return { ok: true as const };
}

/** Sign out every other device (current session survives; caller confirms). */
export async function signOutOtherSessions() {
  const ctx = await getTenantContext();
  const { revokeOtherSessions } = await import("@calder/auth");
  const n = await revokeOtherSessions(ctx.user.userId, ctx.user.sessionId);
  return { revoked: n };
}
