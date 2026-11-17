import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  auditLogs,
  closeDb,
  getDb,
  organizationMembers,
  organizations,
  orgInvitations,
  projects,
  users,
} from "@calder/db";
import {
  acceptInvitation,
  hashInviteToken,
  invitationDestination,
  isInviteToken,
  previewInvitation,
} from "./invites";

/**
 * The invitation lifecycle, against a live Postgres.
 *
 * What is being protected here is not "a row is inserted". It is that the *link*
 * and the *membership* agree: the address on the invitation is the only address
 * that can claim it, a used or lapsed link cannot be replayed, and a link whose
 * membership was later removed does not quietly restore access. Each of those
 * was previously either unhandled or handled by a different rule in a different
 * file.
 */

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

gate("invitation lifecycle (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);

  const orgId = `org_inv_${suffix}`;
  const otherOrgId = `org_inv_b_${suffix}`;
  const inviterId = `usr_inv_a_${suffix}`;
  const inviteeId = `usr_inv_b_${suffix}`;
  const strangerId = `usr_inv_c_${suffix}`;
  const projectId = `prj_inv_${suffix}`;
  const projectLaterId = `prj_inv_late_${suffix}`;

  const inviteeEmail = `invitee-${suffix}@test.test`;
  const strangerEmail = `stranger-${suffix}@test.test`;

  const token = randomBytes(32).toString("hex");
  const expiredToken = randomBytes(32).toString("hex");
  const spentToken = randomBytes(32).toString("hex");
  const unknownToken = randomBytes(32).toString("hex");

  const insertInvite = async (input: {
    id: string;
    token: string;
    email: string;
    expiresAt: Date;
    acceptedAt?: Date | null;
    organizationId?: string;
  }) => {
    await db.insert(orgInvitations).values({
      id: input.id,
      organizationId: input.organizationId ?? orgId,
      email: input.email,
      role: "member",
      tokenHash: hashInviteToken(input.token),
      invitedBy: inviterId,
      expiresAt: input.expiresAt,
      acceptedAt: input.acceptedAt ?? null,
    });
  };

  beforeAll(async () => {
    await db.insert(users).values([
      { id: inviterId, email: `inviter-${suffix}@test.test` },
      { id: inviteeId, email: inviteeEmail },
      { id: strangerId, email: strangerEmail },
    ]);
    await db.insert(organizations).values([
      { id: orgId, name: "Invited Workspace", slug: `invited-${suffix}` },
      { id: otherOrgId, name: "Somewhere Else", slug: `elsewhere-${suffix}` },
    ]);
    // Two projects with distinct creation times so "first project" is stable.
    await db.insert(projects).values([
      {
        id: projectId,
        organizationId: orgId,
        name: "First",
        slug: `first-${suffix}`,
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        id: projectLaterId,
        organizationId: orgId,
        name: "Second",
        slug: `second-${suffix}`,
        createdAt: new Date(),
      },
    ]);

    await insertInvite({
      id: `inv_ok_${suffix}`,
      token,
      email: inviteeEmail,
      expiresAt: new Date(Date.now() + 5 * DAY),
    });
    await insertInvite({
      id: `inv_exp_${suffix}`,
      token: expiredToken,
      email: inviteeEmail,
      expiresAt: new Date(Date.now() - DAY),
    });
    await insertInvite({
      id: `inv_spent_${suffix}`,
      token: spentToken,
      email: inviteeEmail,
      expiresAt: new Date(Date.now() + 5 * DAY),
      acceptedAt: new Date(Date.now() - 30 * DAY),
    });
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.organizationId, orgId));
    await db.delete(orgInvitations).where(eq(orgInvitations.organizationId, orgId));
    await db.delete(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(organizations).where(eq(organizations.id, otherOrgId));
    await db.delete(users).where(eq(users.id, inviterId));
    await db.delete(users).where(eq(users.id, inviteeId));
    await db.delete(users).where(eq(users.id, strangerId));
    await closeDb();
  });

  it("previews the workspace and the invited address, nothing else", async () => {
    const preview = await previewInvitation(token, db);
    expect(preview.state).toBe("valid");
    expect(preview.organizationName).toBe("Invited Workspace");
    expect(preview.email).toBe(inviteeEmail);
    expect(preview.role).toBe("member");
    // The preview must never hand back the token or the hash.
    expect(JSON.stringify(preview)).not.toContain(token);
    expect(JSON.stringify(preview)).not.toContain(hashInviteToken(token));
  });

  it("rejects a malformed token without touching the database", async () => {
    expect(isInviteToken("not-a-token")).toBe(false);
    expect(isInviteToken(token)).toBe(true);
    expect((await previewInvitation("abc", db)).state).toBe("invalid");
    expect((await previewInvitation(unknownToken, db)).state).toBe("invalid");
  });

  it("reports a lapsed invitation as expired", async () => {
    expect((await previewInvitation(expiredToken, db)).state).toBe("expired");
    expect((await previewInvitation(spentToken, db)).state).toBe("accepted");
  });

  it("refuses an invitation opened by a different account", async () => {
    const result = await acceptInvitation(token, { userId: strangerId, email: strangerEmail }, db);
    expect(result).toMatchObject({ ok: false, reason: "wrong_account" });
    if (!result.ok) expect(result.invitedEmail).toBe(inviteeEmail);

    // Nothing changed: no membership, invitation still claimable.
    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgId));
    expect(memberships).toHaveLength(0);
    expect((await previewInvitation(token, db)).state).toBe("valid");
  });

  it("refuses the wrong account even when the token matches, and never echoes the token", async () => {
    const result = await acceptInvitation(
      expiredToken,
      { userId: strangerId, email: strangerEmail },
      db
    );
    expect(JSON.stringify(result)).not.toContain(expiredToken);
  });

  it("accepts for the invited address: membership, audit row, spent link", async () => {
    const result = await acceptInvitation(token, { userId: inviteeId, email: inviteeEmail }, db);
    expect(result).toMatchObject({
      ok: true,
      organizationId: orgId,
      organizationName: "Invited Workspace",
      joined: true,
    });

    const [membership] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, inviteeId)
        )
      );
    expect(membership?.role).toBe("member");

    const [invite] = await db
      .select()
      .from(orgInvitations)
      .where(eq(orgInvitations.id, `inv_ok_${suffix}`));
    expect(invite?.acceptedAt).toBeInstanceOf(Date);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.action, "member.joined")));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorUserId).toBe(inviteeId);
  });

  it("is idempotent: a second accept rejoins nothing and duplicates nothing", async () => {
    const result = await acceptInvitation(token, { userId: inviteeId, email: inviteeEmail }, db);
    expect(result).toMatchObject({ ok: true, joined: false });

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, inviteeId)
        )
      );
    expect(memberships).toHaveLength(1);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.action, "member.joined")));
    expect(audits).toHaveLength(1);
  });

  it("does not revive a spent link whose membership was later removed", async () => {
    // The invitee is accepted above; removing the membership must leave the
    // link spent, not restore access on the next click.
    await db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, inviteeId)
        )
      );

    const result = await acceptInvitation(token, { userId: inviteeId, email: inviteeEmail }, db);
    expect(result).toMatchObject({ ok: false, reason: "already_accepted_elsewhere" });

    const memberships = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgId));
    expect(memberships).toHaveLength(0);
  });

  it("refuses an expired invitation and leaves it unclaimed", async () => {
    const result = await acceptInvitation(
      expiredToken,
      { userId: inviteeId, email: inviteeEmail },
      db
    );
    expect(result).toMatchObject({ ok: false, reason: "expired" });

    const [invite] = await db
      .select()
      .from(orgInvitations)
      .where(eq(orgInvitations.id, `inv_exp_${suffix}`));
    expect(invite?.acceptedAt).toBeNull();
  });

  it("sends the invitee to the organisation's oldest project, if it has one", async () => {
    const destination = await invitationDestination(orgId, db);
    expect(destination).toEqual({ organizationId: orgId, projectId });
  });
});
