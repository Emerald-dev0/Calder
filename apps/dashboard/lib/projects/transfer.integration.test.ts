import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  apiKeys,
  auditLogs,
  audiences,
  broadcasts,
  closeDb,
  domains,
  emails,
  getDb,
  organizations,
  organizationMembers,
  projects,
  senderIdentities,
  suppressions,
  users,
  webhooks,
} from "@calder/db";
import { TransferError, previewProjectTransfer, transferProject } from "./transfer";

/**
 * Moving a project, against a live Postgres.
 *
 * The interesting assertions are not "the foreign key changed" — that is one
 * UPDATE. They are the rows the schema does *not* maintain for us: the
 * denormalised `suppressions.organization_id`, the audit trail on both sides,
 * the destination's plan ceiling, and the promise that a refusal changes
 * nothing at all.
 */

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

gate("project transfer (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);

  const ownerId = `user_owner_${suffix}`;
  const strangerId = `user_stranger_${suffix}`;
  const orgA = `org_a_${suffix}`;
  const orgB = `org_b_${suffix}`;
  const projectId = `prj_move_${suffix}`;
  const secondProjectId = `prj_move2_${suffix}`;

  const memberships = [
    { organizationId: orgA, role: "owner" },
    { organizationId: orgB, role: "owner" },
  ];

  beforeAll(async () => {
    await db.insert(users).values([
      { id: ownerId, email: `owner-${suffix}@example.com`, name: "Owner" },
      { id: strangerId, email: `stranger-${suffix}@example.com`, name: "Stranger" },
    ]);
    await db.insert(organizations).values([
      { id: orgA, name: `Alpha ${suffix}`, slug: `alpha-${suffix}` },
      { id: orgB, name: `Beta ${suffix}`, slug: `beta-${suffix}` },
    ]);
    await db.insert(organizationMembers).values([
      { id: `om_a_${suffix}`, organizationId: orgA, userId: ownerId, role: "owner" },
      { id: `om_b_${suffix}`, organizationId: orgB, userId: ownerId, role: "owner" },
      { id: `om_c_${suffix}`, organizationId: orgA, userId: strangerId, role: "member" },
    ]);
    await db.insert(projects).values([
      {
        id: projectId,
        organizationId: orgA,
        name: "Movable",
        slug: `movable-${suffix}`,
        metadata: { environment: "production" },
      },
      {
        id: secondProjectId,
        organizationId: orgA,
        name: "Second",
        slug: `second-${suffix}`,
      },
    ]);
    await db.insert(domains).values({
      id: `dom_${suffix}`,
      projectId,
      domain: `mail-${suffix}.example.com`,
      status: "verified",
    });
    await db.insert(senderIdentities).values({
      id: `snd_${suffix}`,
      projectId,
      displayName: "Movable",
      email: `hello@mail-${suffix}.example.com`,
      type: "domain",
      status: "verified",
    });
    await db.insert(apiKeys).values({
      id: `key_${suffix}`,
      projectId,
      name: "live key",
      keyPrefix: "calder_sk_live_move",
      keyHash: `hash_${suffix}`,
      env: "live",
    });
    await db.insert(webhooks).values({
      id: `wh_${suffix}`,
      projectId,
      url: `https://example.com/hook-${suffix}`,
      secret: "secret",
      events: ["email.delivered"],
    });
    await db.insert(emails).values({
      id: `eml_${suffix}`,
      projectId,
      from: `hello@mail-${suffix}.example.com`,
      to: "someone@example.com",
      subject: "History",
      status: "delivered",
    });
    // Inserted without an explicit organizationId: the DB trigger derives it
    // from the project, which is exactly the row the transfer has to rewrite.
    await db.insert(suppressions).values({
      id: `sup_${suffix}`,
      projectId,
      email: "bounced@example.com",
      reason: "bounce",
      organizationId: orgA,
    });
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, orgA));
    await db.delete(organizations).where(eq(organizations.id, orgB));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, strangerId));
  });

  it("describes the move without changing anything", async () => {
    const preview = await previewProjectTransfer({
      viewerUserId: ownerId,
      memberships,
      projectId,
      destinationOrganizationId: orgB,
    });

    expect(preview.inventory).toMatchObject({
      domains: 1,
      verifiedDomains: 1,
      senders: 1,
      apiKeys: 1,
      webhooks: 1,
      emails: 1,
      suppressions: 1,
      broadcasts: 0,
    });
    expect(preview.blockers).toEqual([]);
    expect(preview.slugConflict).toBe(false);
    expect(preview.warnings.join(" ")).toMatch(/keep working/);
    expect(preview.warnings.join(" ")).toMatch(/Usage history stays/);

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row?.organizationId).toBe(orgA);
  });

  it("refuses a caller who is not an owner or admin of the destination", async () => {
    await expect(
      previewProjectTransfer({
        viewerUserId: strangerId,
        memberships: [{ organizationId: orgA, role: "member" }],
        projectId,
        destinationOrganizationId: orgB,
      })
    ).rejects.toBeInstanceOf(TransferError);
  });

  it("refuses a confirmation that does not match the project name", async () => {
    await expect(
      transferProject({
        viewerUserId: ownerId,
        memberships,
        projectId,
        destinationOrganizationId: orgB,
        confirmation: "Something else",
      })
    ).rejects.toMatchObject({ code: "confirmation_mismatch" });

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row?.organizationId).toBe(orgA);
  });

  it("blocks a project that carries broadcasts, without touching it", async () => {
    await db.insert(audiences).values({
      id: `aud_${suffix}`,
      organizationId: orgA,
      projectId: secondProjectId,
      name: `Audience ${suffix}`,
    });
    await db.insert(broadcasts).values({
      id: `bc_${suffix}`,
      organizationId: orgA,
      projectId: secondProjectId,
      audienceId: `aud_${suffix}`,
      senderId: `snd_${suffix}`,
      name: "Campaign",
      subject: "Hello",
      status: "draft",
    });

    const preview = await previewProjectTransfer({
      viewerUserId: ownerId,
      memberships,
      projectId: secondProjectId,
      destinationOrganizationId: orgB,
    });
    expect(preview.blockers.join(" ")).toMatch(/broadcast/i);

    await expect(
      transferProject({
        viewerUserId: ownerId,
        memberships,
        projectId: secondProjectId,
        destinationOrganizationId: orgB,
        confirmation: "Second",
      })
    ).rejects.toMatchObject({ code: "blocked" });

    const [row] = await db.select().from(projects).where(eq(projects.id, secondProjectId));
    expect(row?.organizationId).toBe(orgA);
  });

  it("moves the project, its resources and the denormalised suppression org id", async () => {
    const result = await transferProject({
      viewerUserId: ownerId,
      memberships,
      projectId,
      destinationOrganizationId: orgB,
      confirmation: "Movable",
    });

    expect(result).toMatchObject({ projectId, fromOrganizationId: orgA, toOrganizationId: orgB });

    const [moved] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(moved?.organizationId).toBe(orgB);
    // Identity preserved: same id, same slug, same metadata.
    expect(moved?.id).toBe(projectId);
    expect(moved?.metadata).toMatchObject({ environment: "production" });

    // Resources follow the project because they are keyed on project_id.
    for (const [table, column] of [
      [domains, domains.projectId],
      [senderIdentities, senderIdentities.projectId],
      [apiKeys, apiKeys.projectId],
      [webhooks, webhooks.projectId],
      [emails, emails.projectId],
    ] as const) {
      const rows = await db
        .select({ id: sql<string>`id` })
        .from(table as never)
        .where(eq(column as never, projectId));
      expect(rows.length, `${String(table)} lost its rows`).toBeGreaterThan(0);
    }

    const suppressionRows = await db
      .select()
      .from(suppressions)
      .where(eq(suppressions.projectId, projectId));
    expect(suppressionRows).toHaveLength(1);
    expect(suppressionRows[0]?.organizationId).toBe(orgB);

    // Both sides can answer "where did this go".
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.targetId, projectId), eq(auditLogs.action, "project.transferred_out"))
      );
    expect(audit).toHaveLength(1);
    expect((audit[0]?.metadata as Record<string, unknown>).toOrganizationId).toBe(orgB);
    const inbound = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.targetId, projectId), eq(auditLogs.action, "project.transferred_in"))
      );
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.organizationId).toBe(orgB);
  });

  it("resolves a slug the destination already uses", async () => {
    // Second project (no broadcasts now — delete the blocker first) carries the
    // same slug family as one created directly in the destination.
    await db.delete(broadcasts).where(eq(broadcasts.projectId, secondProjectId));
    const [second] = await db.select().from(projects).where(eq(projects.id, secondProjectId));
    await db.insert(projects).values({
      id: `prj_taken_${suffix}`,
      organizationId: orgB,
      name: "Squatter",
      slug: second!.slug,
    });

    const preview = await previewProjectTransfer({
      viewerUserId: ownerId,
      memberships,
      projectId: secondProjectId,
      destinationOrganizationId: orgB,
    });
    expect(preview.slugConflict).toBe(true);
    expect(preview.resolvedSlug).toBe(`${second!.slug}-2`);

    const result = await transferProject({
      viewerUserId: ownerId,
      memberships,
      projectId: secondProjectId,
      destinationOrganizationId: orgB,
      confirmation: "Second",
    });
    expect(result.slug).toBe(`${second!.slug}-2`);
  });
});

/**
 * A refusal must be total. The destination here is on the free plan, whose
 * ceiling is two domains, and it already has two — so the incoming project's
 * single domain does not fit. The project must still be exactly where it was,
 * with its domain, its suppressions and no audit rows anywhere.
 */
gate("project transfer refuses a destination that has no room", () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);

  const ownerId = `user_limit_${suffix}`;
  const orgSource = `org_src_${suffix}`;
  const orgFull = `org_full_${suffix}`;
  const projectId = `prj_limit_${suffix}`;
  const squatProjectId = `prj_squat_${suffix}`;

  beforeAll(async () => {
    await db.insert(users).values({ id: ownerId, email: `limit-${suffix}@example.com` });
    await db.insert(organizations).values([
      { id: orgSource, name: `Source ${suffix}`, slug: `source-${suffix}` },
      { id: orgFull, name: `Full ${suffix}`, slug: `full-${suffix}` },
    ]);
    await db.insert(organizationMembers).values([
      { id: `om_s_${suffix}`, organizationId: orgSource, userId: ownerId, role: "owner" },
      { id: `om_f_${suffix}`, organizationId: orgFull, userId: ownerId, role: "owner" },
    ]);
    await db.insert(projects).values([
      { id: projectId, organizationId: orgSource, name: "Traveller", slug: `traveller-${suffix}` },
      { id: squatProjectId, organizationId: orgFull, name: "Squatter", slug: `squatter-${suffix}` },
    ]);
    await db.insert(domains).values([
      {
        id: `dom_t_${suffix}`,
        projectId,
        domain: `traveller-${suffix}.example.com`,
        status: "pending",
      },
      { id: `dom_x_${suffix}`, projectId: squatProjectId, domain: `one-${suffix}.example.com` },
      { id: `dom_y_${suffix}`, projectId: squatProjectId, domain: `two-${suffix}.example.com` },
    ]);
    await db.insert(suppressions).values({
      id: `sup_limit_${suffix}`,
      projectId,
      email: "hard@example.com",
      reason: "complaint",
      organizationId: orgSource,
    });
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, orgSource));
    await db.delete(organizations).where(eq(organizations.id, orgFull));
    await db.delete(users).where(eq(users.id, ownerId));
    await closeDb();
  });

  it("explains the domain ceiling on the confirmation screen", async () => {
    const preview = await previewProjectTransfer({
      viewerUserId: ownerId,
      memberships: [
        { organizationId: orgSource, role: "owner" },
        { organizationId: orgFull, role: "owner" },
      ],
      projectId,
      destinationOrganizationId: orgFull,
    });
    expect(preview.destinationDomains).toEqual({ used: 2, limit: 2 });
    expect(preview.blockers.join(" ")).toMatch(/room for 0 more domains/);
  });

  it("rolls everything back when the transfer is forced anyway", async () => {
    await expect(
      transferProject({
        viewerUserId: ownerId,
        memberships: [
          { organizationId: orgSource, role: "owner" },
          { organizationId: orgFull, role: "owner" },
        ],
        projectId,
        destinationOrganizationId: orgFull,
        confirmation: "Traveller",
      })
    ).rejects.toMatchObject({ code: "destination_limit" });

    const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(row?.organizationId).toBe(orgSource);

    const suppressionRows = await db
      .select()
      .from(suppressions)
      .where(eq(suppressions.projectId, projectId));
    expect(suppressionRows[0]?.organizationId).toBe(orgSource);

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.targetId, projectId));
    expect(audit).toHaveLength(0);
  });
});

// One connection pool for the file: closing it inside a suite would pull the
// floor out from under the suites that run after it.
afterAll(async () => {
  await closeDb();
});
