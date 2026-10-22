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
import { redirect } from "next/navigation";
import { getTenantContext } from "../../../lib/auth";
import { getConfig } from "@calder/config";
import { sendCompanyEmailQuietly } from "@calder/notify";

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/** The timestamp format every "something changed" email uses. */
function formatWhen(date: Date): string {
  const stamped = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
  return `${stamped} UTC`;
}

async function organizationLabel(
  db: ReturnType<typeof getDb>,
  organizationId: string
): Promise<string> {
  const [row] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.name ?? "your workspace";
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
  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return {
    organization: organization ?? null,
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
  const inviteId = rid("inv");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(orgInvitations).values({
    id: inviteId,
    organizationId: orgId,
    email: clean,
    role,
    tokenHash,
    invitedBy: inviter.user.userId,
    expiresAt,
  });
  const appUrl = getConfig().APP_URL.replace(/\/$/, "");
  const inviteLink = `${appUrl}/invite/${rawToken}`;

  const [organization] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  // The invitee may have no Calder account yet, so this cannot be a preference
  // decision: it is the only way they learn the workspace exists. A send
  // failure still leaves the link on screen for the inviter to pass on.
  await sendCompanyEmailQuietly(db, {
    id: "organization.invitation",
    to: clean,
    organizationId: orgId,
    idempotencyKey: `invite:${inviteId}`,
    data: {
      inviterName: inviter.user.name ?? inviter.user.email,
      organizationName: organization?.name ?? "a Calder workspace",
      role,
      acceptUrl: inviteLink,
      expiresInDays: 7,
    },
  });

  await audit(db, {
    organizationId: orgId,
    actorUserId: inviter.user.userId,
    action: "member.invited",
    targetType: "invitation",
    targetId: inviteId,
  });
  return { inviteLink, invited: true };
}

export async function updateMemberRole(orgId: string, membershipId: string, role: Role) {
  const ctx = await getTenantContext();
  const caller = await callerRole(ctx.user.userId, orgId);
  if (caller !== "owner") throw new Error("Only owners can change roles.");
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new Error("Invalid role.");
  }
  const db = getDb();
  // Read the target before writing: the email needs the previous role, and the
  // old row is gone the moment the update lands.
  const [target] = await db
    .select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      email: users.email,
      name: users.name,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    )
    .limit(1);
  if (!target) throw new Error("Member not found.");

  // Never demote/remove the last owner, an org without an owner is orphaned.
  if (role !== "owner" && target.role === "owner") {
    const owners = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, "owner"))
      );
    if (owners.length <= 1) {
      throw new Error("Cannot demote the last owner, transfer ownership first.");
    }
  }
  if (target.role === role) return { ok: true as const };

  await db
    .update(organizationMembers)
    .set({ role })
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    );

  // A role change is a permission change; the person it affects is told even
  // when an owner did it deliberately. Silent demotions are how insider
  // surprises happen.
  if (target.userId !== ctx.user.userId) {
    await sendCompanyEmailQuietly(db, {
      id: "organization.role_changed",
      to: target.email,
      userId: target.userId,
      organizationId: orgId,
      idempotencyKey: `role:${membershipId}:${role}:${Date.now()}`,
      data: {
        organizationName: await organizationLabel(db, orgId),
        oldRole: target.role,
        newRole: role,
        changedBy: ctx.user.name ?? ctx.user.email,
        when: formatWhen(new Date()),
      },
    });
  }

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
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    )
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
  await db
    .delete(organizationMembers)
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    );

  // Tell the person, not just the audit log: after this row is gone they can
  // no longer open the workspace to find out why.
  const [removed] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, target[0].userId))
    .limit(1);
  if (removed) {
    await sendCompanyEmailQuietly(db, {
      id: "organization.member_removed",
      to: removed.email,
      userId: target[0].userId,
      organizationId: orgId,
      idempotencyKey: `removed:${membershipId}`,
      data: {
        organizationName: await organizationLabel(db, orgId),
        removedBy: ctx.user.name ?? ctx.user.email,
        when: formatWhen(new Date()),
      },
    });
  }

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
  // "Sign out everywhere" is the move people make when they think somebody
  // else has their password. The confirmation belongs in the same inbox.
  if (n > 0) {
    await sendCompanyEmailQuietly(getDb(), {
      id: "account.sessions_revoked",
      to: ctx.user.email,
      userId: ctx.user.userId,
      idempotencyKey: `sessions:${ctx.user.userId}:${Date.now()}`,
      data: {
        when: formatWhen(new Date()),
        reason: `requested from account settings — ${n} ${n === 1 ? "device" : "devices"} signed out`,
      },
    });
  }
  return { revoked: n };
}

/**
 * Move ownership from the caller to another member.
 *
 * Two writes, not a swap in one statement: the target becomes an owner first
 * so the organization is never ownerless even if the second write is the one
 * that fails. The caller is demoted to admin rather than member — they chose
 * this person, and stripping their access at the same moment would be a
 * punishment nobody asked for.
 */
export async function transferOwnership(orgId: string, membershipId: string) {
  const ctx = await getTenantContext();
  const caller = await callerRole(ctx.user.userId, orgId);
  if (caller !== "owner") throw new Error("Only an owner can transfer ownership.");

  const db = getDb();
  const [target] = await db
    .select({
      id: organizationMembers.id,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      email: users.email,
      name: users.name,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    )
    .limit(1);
  if (!target) throw new Error("Member not found.");
  if (target.userId === ctx.user.userId) throw new Error("You already own this workspace.");
  if (target.role === "owner") throw new Error("That member is already an owner.");

  await db
    .update(organizationMembers)
    .set({ role: "owner" })
    .where(
      and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, orgId))
    );
  await db
    .update(organizationMembers)
    .set({ role: "admin" })
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, ctx.user.userId)
      )
    );

  const organizationName = await organizationLabel(db, orgId);
  const stamp = Date.now();
  const actor = ctx.user.name ?? ctx.user.email;

  // Both sides hear the same fact from their own direction. Two keys, because
  // the idempotency index is global and one would swallow the other.
  await sendCompanyEmailQuietly(db, {
    id: "organization.ownership_transferred",
    to: target.email,
    userId: target.userId,
    organizationId: orgId,
    idempotencyKey: `ownership:${orgId}:to:${target.userId}:${stamp}`,
    data: {
      organizationName,
      direction: "to you",
      otherParty: actor,
      when: formatWhen(new Date()),
    },
  });
  await sendCompanyEmailQuietly(db, {
    id: "organization.ownership_transferred",
    to: ctx.user.email,
    userId: ctx.user.userId,
    organizationId: orgId,
    idempotencyKey: `ownership:${orgId}:from:${ctx.user.userId}:${stamp}`,
    data: {
      organizationName,
      direction: "from you",
      otherParty: target.name ?? target.email,
      when: formatWhen(new Date()),
    },
  });

  await audit(db, {
    organizationId: orgId,
    actorUserId: ctx.user.userId,
    action: "member.ownership_transferred",
    targetType: "membership",
    targetId: membershipId,
  });
  return { ok: true as const };
}

/**
 * Start an email-address change.
 *
 * The confirmation link goes to the address being replaced, never to the new
 * one: whoever controls the current inbox must bless the move. Nothing changes
 * until the link is followed, and the link dies in an hour.
 */
export async function requestEmailChange(formData: FormData) {
  const ctx = await getTenantContext();
  const next = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(next)) {
    redirect("/settings?emailChange=invalid");
  }
  if (next === ctx.user.email.toLowerCase()) {
    redirect("/settings?emailChange=same");
  }

  const db = getDb();
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, next))
    .limit(1);
  if (taken) redirect("/settings?emailChange=taken");

  const { signEmailChangeToken } = await import("../../../lib/email-change");
  const { token, expiresAt } = signEmailChangeToken({
    userId: ctx.user.userId,
    from: ctx.user.email,
    to: next,
  });
  const link = `${getConfig().APP_URL.replace(/\/$/, "")}/api/auth/email-change/confirm?token=${encodeURIComponent(token)}`;

  await sendCompanyEmailQuietly(db, {
    id: "account.email_change_requested",
    to: ctx.user.email,
    userId: ctx.user.userId,
    // One request per (account, address, hour): asking twice for the same
    // change re-uses the live link instead of producing a second email.
    idempotencyKey: `email-change:${ctx.user.userId}:${next}:${expiresAt.getTime()}`,
    data: {
      newEmail: next,
      confirmUrl: link,
      expiresInHours: 1,
    },
  });

  redirect("/settings?emailChange=sent");
}
