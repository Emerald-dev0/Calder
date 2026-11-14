import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  auditLogs,
  getDb,
  organizationMembers,
  organizations,
  orgInvitations,
  projects,
  type DbClient,
} from "@calder/db";
import { logger } from "@calder/observability";

/**
 * One place where an invitation token is turned into membership.
 *
 * Before this module there were two different rules: `acceptPendingInvites` in
 * the auth package silently joined *every* pending invite matching the login
 * email, and `/invite/<token>` only previewed. Nothing tied the link the
 * invitee clicked to the membership they got, so the states that matter —
 * expired, revoked, already used, wrong account — had nowhere to be answered,
 * and a signed-in visitor could not accept at all.
 *
 * Rules held here:
 *
 *  - The raw token is the capability. It is hashed (SHA-256) before any query
 *    and never logged, stored, or returned in an error.
 *  - Only the address the invitation was issued to may accept it. Being signed
 *    in is not consent, and it is not identity either: a different account on
 *    the same browser is refused, not silently given somebody else's seat.
 *  - Accepting is idempotent. The second call returns the same organisation
 *    instead of failing, so a refreshed form or a double-click is harmless.
 *  - An invitation accepted long ago, whose membership has since been removed,
 *    does not re-grant access. The link is spent, the removal stands.
 */

/** A token is 32 random bytes, hex-encoded. Anything else cannot exist. */
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** SHA-256 of the raw token; the only form that touches the database. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** Cheap shape check that avoids a pointless query for junk URLs. */
export function isInviteToken(rawToken: string | null | undefined): rawToken is string {
  return typeof rawToken === "string" && TOKEN_PATTERN.test(rawToken);
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type InvitationState = "valid" | "accepted" | "expired" | "revoked" | "invalid";

export interface InvitationPreview {
  state: InvitationState;
  /** Only present for `valid`/`accepted`/`expired` — a real row exists. */
  organizationName?: string;
  organizationId?: string;
  /** The address the invite was issued to. Shown so the viewer can compare. */
  email?: string;
  role?: string;
  expiresAt?: Date;
}

/**
 * Unauthenticated preview: the token IS the capability, so this deliberately
 * reveals the workspace name and the invited address (and nothing else).
 * A revoked invitation is a deleted row, which is indistinguishable from a
 * token that never existed — the same 404-shaped answer for both.
 */
export async function previewInvitation(
  rawToken: string,
  db: DbClient = getDb()
): Promise<InvitationPreview> {
  if (!isInviteToken(rawToken)) return { state: "invalid" };

  const [row] = await db
    .select({
      organizationId: orgInvitations.organizationId,
      email: orgInvitations.email,
      role: orgInvitations.role,
      acceptedAt: orgInvitations.acceptedAt,
      expiresAt: orgInvitations.expiresAt,
      organizationName: organizations.name,
    })
    .from(orgInvitations)
    .innerJoin(organizations, eq(organizations.id, orgInvitations.organizationId))
    .where(eq(orgInvitations.tokenHash, hashInviteToken(rawToken)))
    .limit(1);

  if (!row) return { state: "invalid" };

  const base = {
    organizationName: row.organizationName,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
  };
  if (row.acceptedAt) return { state: "accepted", ...base };
  if (row.expiresAt.getTime() <= Date.now()) return { state: "expired", ...base };
  return { state: "valid", ...base };
}

export type AcceptInvitationResult =
  | {
      ok: true;
      organizationId: string;
      organizationName: string;
      /** True when this call created the membership, false on a replay. */
      joined: boolean;
    }
  | {
      ok: false;
      reason: "invalid" | "expired" | "already_accepted_elsewhere" | "wrong_account";
      organizationName?: string;
      /** The invited address, so the caller can say who the link belongs to. */
      invitedEmail?: string;
    };

export interface InvitationViewer {
  userId: string;
  email: string;
}

/**
 * Accept an invitation for an authenticated viewer.
 *
 * Transactional: the membership insert and the `accepted_at` flip happen
 * together, under a row lock, so two concurrent accepts (two tabs, or the
 * login auto-accept racing the button) cannot both claim it. The unique index
 * on (organization_id, user_id) is the second line of defence.
 */
export async function acceptInvitation(
  rawToken: string,
  viewer: InvitationViewer,
  db: DbClient = getDb()
): Promise<AcceptInvitationResult> {
  if (!isInviteToken(rawToken)) return { ok: false, reason: "invalid" };

  const tokenHash = hashInviteToken(rawToken);
  const viewerEmail = normaliseEmail(viewer.email);

  return db.transaction(async (tx) => {
    // Lock the invitation row itself: the organisation name is a second read
    // because `FOR UPDATE` belongs on the row being claimed, not on a join.
    const [invite] = await tx
      .select({
        id: orgInvitations.id,
        organizationId: orgInvitations.organizationId,
        email: orgInvitations.email,
        role: orgInvitations.role,
        acceptedAt: orgInvitations.acceptedAt,
        expiresAt: orgInvitations.expiresAt,
      })
      .from(orgInvitations)
      .where(eq(orgInvitations.tokenHash, tokenHash))
      .limit(1)
      .for("update");

    if (!invite) return { ok: false, reason: "invalid" } as const;

    const [organization] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, invite.organizationId))
      .limit(1);
    const organizationName = organization?.name ?? "this workspace";

    // Identity check before state check: someone signed into the wrong account
    // should be told *that*, not that their link is dead.
    if (normaliseEmail(invite.email) !== viewerEmail) {
      return {
        ok: false,
        reason: "wrong_account",
        organizationName,
        invitedEmail: invite.email,
      } as const;
    }

    const [existing] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, invite.organizationId),
          eq(organizationMembers.userId, viewer.userId)
        )
      )
      .limit(1);

    if (invite.acceptedAt) {
      // Already used. Fine if the person is still a member (replay of the page
      // or a second click); a spent link must not restore access that was
      // removed afterwards.
      if (existing) {
        return {
          ok: true,
          organizationId: invite.organizationId,
          organizationName,
          joined: false,
        } as const;
      }
      return { ok: false, reason: "already_accepted_elsewhere" } as const;
    }

    if (invite.expiresAt.getTime() <= Date.now()) {
      return {
        ok: false,
        reason: "expired",
        organizationName,
        invitedEmail: invite.email,
      } as const;
    }

    if (!existing) {
      await tx
        .insert(organizationMembers)
        .values({
          id: newId("orgm"),
          organizationId: invite.organizationId,
          userId: viewer.userId,
          role: invite.role,
        })
        .onConflictDoNothing();
    }

    await tx
      .update(orgInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(orgInvitations.id, invite.id));

    // Audit inside the transaction: a membership that exists without a trail is
    // worse than no membership, and an audit row for a rolled-back join is a
    // lie. `audit_logs` has no foreign key to memberships, so this cannot fail
    // for referential reasons.
    await tx.insert(auditLogs).values({
      id: newId("audit"),
      organizationId: invite.organizationId,
      actorUserId: viewer.userId,
      action: "member.joined",
      targetType: "membership",
      targetId: viewer.userId,
    });

    return {
      ok: true,
      organizationId: invite.organizationId,
      organizationName,
      joined: !existing,
    } as const;
  });
}

/**
 * Where an accepted invitation should land.
 *
 * The active context is a cookie, validated against the caller's memberships on
 * every render, so this only *suggests* the destination: the organisation they
 * just joined, and its first project if it has one (the overview is
 * organisation-scoped when it does not).
 */
export async function invitationDestination(
  organizationId: string,
  db: DbClient = getDb()
): Promise<{ organizationId: string; projectId: string | null }> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .limit(1);
  return { organizationId, projectId: project?.id ?? null };
}

/** Structured, token-free logging: the raw link never reaches a log line. */
export function logInvitationOutcome(
  result: AcceptInvitationResult,
  context: { userId: string }
): void {
  if (result.ok) {
    logger.info(
      { userId: context.userId, organizationId: result.organizationId, joined: result.joined },
      "Invitation accepted"
    );
    return;
  }
  if (result.reason === "wrong_account") {
    logger.warn({ userId: context.userId }, "Invitation refused: different account");
    return;
  }
  logger.info({ userId: context.userId, reason: result.reason }, "Invitation not accepted");
}
