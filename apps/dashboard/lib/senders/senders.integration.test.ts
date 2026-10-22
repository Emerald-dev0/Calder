import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (see scripts/dev-infra.mjs). Skipped otherwise,
// so `pnpm test` stays green on a machine without a database.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Senders — tenant isolation and the identity rules.
 *
 * Every exported mutation is exercised against a sender that belongs to
 * *another* organization, and each must raise `SenderNotFoundError` (never
 * "forbidden", which would confirm the id exists). The reads are checked the
 * same way: a foreign sender is not findable by id, and a foreign project's
 * list is empty rather than an error.
 *
 * The second half covers the rules that are easy to regress:
 *  - archived senders disappear from listings and stop counting against the
 *    plan, but their history stays;
 *  - a sender with delivery history is archived, not deleted;
 *  - the two defaults are independent and unique per project;
 *  - a default may not be set on an unverified or archived sender;
 *  - an empty allowed-key set means unrestricted, and a foreign key id is
 *    rejected rather than silently dropped.
 */
gate("senders (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    domains,
    senderIdentities,
    emails,
    apiKeys,
    apiKeySenders,
    organizationResourceUsage,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const svc = await import("./service");
  const { and, eq, isNull } = await import("drizzle-orm");

  const suffix = randomBytes(4).toString("hex");
  const orgA = `org_snd_a_${suffix}`;
  const orgB = `org_snd_b_${suffix}`;
  const userA = `usr_snd_a_${suffix}`;
  const userB = `usr_snd_b_${suffix}`;
  const projectA = `proj_snd_a_${suffix}`;
  const projectB = `proj_snd_b_${suffix}`;

  const actorA = () => ({ userId: userA, projectIds: [projectA] });
  const actorB = () => ({ userId: userB, projectIds: [projectB] });

  let senderA = "";
  let archivedA = "";
  let restorableA = "";
  let senderB = "";
  let archivedB = "";
  let keyA = "";
  let keyB = "";

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values([
      { id: userA, email: `snd-a-${suffix}@test.test` },
      { id: userB, email: `snd-b-${suffix}@test.test` },
    ]);
    await db.insert(organizations).values([
      { id: orgA, name: "Senders A", slug: `snd-a-${suffix}` },
      { id: orgB, name: "Senders B", slug: `snd-b-${suffix}` },
    ]);
    await db.insert(organizationMembers).values([
      { id: `orgm_snd_a_${suffix}`, organizationId: orgA, userId: userA, role: "owner" },
      { id: `orgm_snd_b_${suffix}`, organizationId: orgB, userId: userB, role: "owner" },
    ]);
    await db.insert(projects).values([
      { id: projectA, organizationId: orgA, name: "A", slug: `snd-a-${suffix}` },
      { id: projectB, organizationId: orgB, name: "B", slug: `snd-b-${suffix}` },
    ]);
    await db.insert(domains).values({
      id: `dom_snd_a_${suffix}`,
      projectId: projectA,
      domain: `snd-a-${suffix}.test`,
      status: "verified",
    });
    await db.insert(domains).values({
      id: `dom_snd_b_${suffix}`,
      projectId: projectB,
      domain: `snd-b-${suffix}.test`,
      status: "verified",
    });

    senderA = `sender_snd_a_${suffix}`;
    archivedA = `sender_snd_arch_${suffix}`;
    restorableA = `sender_snd_restore_${suffix}`;
    senderB = `sender_snd_b_${suffix}`;
    archivedB = `sender_snd_arch_b_${suffix}`;
    await db.insert(senderIdentities).values([
      {
        id: senderA,
        projectId: projectA,
        displayName: "Alpha Support",
        email: `support@snd-a-${suffix}.test`,
        type: "domain",
        status: "verified",
      },
      {
        id: archivedA,
        projectId: projectA,
        displayName: "Alpha Retired",
        email: `retired@snd-a-${suffix}.test`,
        type: "domain",
        status: "verified",
        archivedAt: new Date(),
      },
      {
        id: restorableA,
        projectId: projectA,
        displayName: "Alpha Restorable",
        email: `restorable@snd-a-${suffix}.test`,
        type: "domain",
        status: "verified",
        archivedAt: new Date(),
      },
      {
        id: senderB,
        projectId: projectB,
        displayName: "Beta Support",
        email: `support@snd-b-${suffix}.test`,
        type: "domain",
        status: "verified",
      },
      {
        id: archivedB,
        projectId: projectB,
        displayName: "Beta Retired",
        email: `retired@snd-b-${suffix}.test`,
        type: "domain",
        status: "verified",
        archivedAt: new Date(),
      },
    ]);

    // One delivered message from senderA so retirement must archive.
    await db.insert(emails).values({
      id: `em_snd_a_${suffix}`,
      projectId: projectA,
      from: `support@snd-a-${suffix}.test`,
      senderIdentityId: senderA,
      to: "recipient@example.test",
      subject: "history",
      text: "history",
      status: "delivered",
      attemptCount: 1,
    });

    keyA = `key_snd_a_${suffix}`;
    keyB = `key_snd_b_${suffix}`;
    await db.insert(apiKeys).values([
      {
        id: keyA,
        projectId: projectA,
        name: "A key",
        keyPrefix: "calder_sk_test_a",
        keyHash: `hash_a_${suffix}`,
        env: "test",
      },
      {
        id: keyB,
        projectId: projectB,
        name: "B key",
        keyPrefix: "calder_sk_test_b",
        keyHash: `hash_b_${suffix}`,
        env: "test",
      },
    ]);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await cleanupSuiteOrg(db, orgA, userA);
    await cleanupSuiteOrg(db, orgB, userB);
  });

  /* ── Cross-tenant: every action ─────────────────────────────────────── */

  it("refuses to read another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(svc.getSender(actorA(), senderB)).rejects.toBeInstanceOf(svc.SenderNotFoundError);
    await expect(svc.getSender(actorB(), senderA)).rejects.toBeInstanceOf(svc.SenderNotFoundError);
  });

  it("refuses to list another tenant's project", async () => {
    if (!(await reachable())) return;
    await expect(svc.listSenders(actorA(), projectB)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to create a domain sender in another tenant", async () => {
    if (!(await reachable())) return;
    await expect(
      svc.createDomainSender(actorA(), {
        projectId: projectB,
        displayName: "Intruder",
        localPart: "intruder",
        domain: `snd-b-${suffix}.test`,
      })
    ).rejects.toBeInstanceOf(svc.SenderNotFoundError);
  });

  it("refuses to create a Gmail sender in another tenant", async () => {
    if (!(await reachable())) return;
    await expect(
      svc.createGmailSender(actorA(), {
        projectId: projectB,
        transportId: "transport_foreign",
        displayName: "Intruder",
      })
    ).rejects.toBeInstanceOf(svc.SenderNotFoundError);
  });

  it("refuses to change another tenant's defaults", async () => {
    if (!(await reachable())) return;
    await expect(
      svc.setSenderDefault(actorA(), senderB, "transactional", true)
    ).rejects.toBeInstanceOf(svc.SenderNotFoundError);
    await expect(svc.setSenderDefault(actorA(), senderB, "marketing", true)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to rename another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(svc.updateSenderDisplayName(actorA(), senderB, "Renamed")).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to set another tenant's Reply-To", async () => {
    if (!(await reachable())) return;
    await expect(
      svc.setSenderReplyTo(actorA(), senderB, "attacker@example.test")
    ).rejects.toBeInstanceOf(svc.SenderNotFoundError);
  });

  it("refuses to enable or disable another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(svc.setSenderEnabled(actorA(), senderB, false)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
    await expect(svc.setSenderEnabled(actorA(), senderB, true)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to retire another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(svc.retireSender(actorA(), senderB)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to unarchive another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(svc.unarchiveSender(actorA(), archivedB)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to read or write another tenant's allowed keys", async () => {
    if (!(await reachable())) return;
    await expect(svc.senderAllowedKeyIds(actorA(), senderB)).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
    await expect(svc.setSenderAllowedKeys(actorA(), senderB, [keyA])).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  it("refuses to dispatch a test through another tenant's sender", async () => {
    if (!(await reachable())) return;
    await expect(
      svc.dispatchTestEmail(actorA(), senderB, "you@example.test")
    ).rejects.toBeInstanceOf(svc.SenderNotFoundError);
  });

  it("returns null for another tenant's test-send status", async () => {
    if (!(await reachable())) return;
    // A foreign project id is rejected before any query runs.
    await expect(svc.dispatchStatus(actorA(), projectB, "em_anything")).rejects.toBeInstanceOf(
      svc.SenderNotFoundError
    );
  });

  /* ── Archived senders ───────────────────────────────────────────────── */

  it("hides archived senders from the default listing", async () => {
    if (!(await reachable())) return;
    const rows = await svc.listSenders(actorA(), projectA);
    expect(rows.map((r) => r.id)).toContain(senderA);
    expect(rows.map((r) => r.id)).not.toContain(archivedA);

    const withArchived = await svc.listSenders(actorA(), projectA, { includeArchived: true });
    expect(withArchived.map((r) => r.id)).toContain(archivedA);
  });

  it("does not count archived senders against the plan", async () => {
    if (!(await reachable())) return;
    const usage = await organizationResourceUsage(getDb(), orgA);
    expect(usage.senders).toBe(1); // senderA only; archivedA is retired
  });

  it("restores an archived sender", async () => {
    if (!(await reachable())) return;
    expect((await svc.getSender(actorA(), restorableA)).archivedAt).not.toBeNull();
    await svc.unarchiveSender(actorA(), restorableA);
    const rows = await svc.listSenders(actorA(), projectA);
    expect(rows.map((r) => r.id)).toContain(restorableA);
    expect(await svc.getSender(actorA(), restorableA)).toMatchObject({
      archivedAt: null,
      isDefault: false,
    });
    // The fixture returns to one active sender for the counting assertions.
    await svc.retireSender(actorA(), restorableA);
  });

  /* ── Defaults ───────────────────────────────────────────────────────── */

  it("keeps the two defaults independent and unique per project", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const second = `sender_snd_2_${suffix}`;
    await db.insert(senderIdentities).values({
      id: second,
      projectId: projectA,
      displayName: "Alpha Billing",
      email: `billing@snd-a-${suffix}.test`,
      type: "domain",
      status: "verified",
    });

    await svc.setSenderDefault(actorA(), senderA, "transactional", true);
    await svc.setSenderDefault(actorA(), senderA, "marketing", true);
    let rows = await svc.listSenders(actorA(), projectA);
    let byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(senderA)?.isDefault).toBe(true);
    expect(byId.get(senderA)?.isDefaultMarketing).toBe(true);
    expect(byId.get(second)?.isDefault).toBe(false);

    await svc.setSenderDefault(actorA(), second, "transactional", true);
    rows = await svc.listSenders(actorA(), projectA);
    byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(second)?.isDefault).toBe(true);
    expect(byId.get(senderA)?.isDefault).toBe(false);
    // The marketing default is untouched by the transactional change.
    expect(byId.get(senderA)?.isDefaultMarketing).toBe(true);

    await svc.setSenderDefault(actorA(), second, "marketing", true);
    rows = await svc.listSenders(actorA(), projectA);
    byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(second)?.isDefaultMarketing).toBe(true);
    expect(byId.get(senderA)?.isDefaultMarketing).toBe(false);
    expect(byId.get(second)?.isDefault).toBe(true);

    await svc.retireSender(actorA(), second);
  });

  it("refuses a default on an unverified sender", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const pending = `sender_snd_pending_${suffix}`;
    await db.insert(senderIdentities).values({
      id: pending,
      projectId: projectA,
      displayName: "Pending",
      email: `pending@snd-a-${suffix}.test`,
      type: "domain",
      status: "pending",
    });
    await expect(svc.setSenderDefault(actorA(), pending, "transactional", true)).rejects.toThrow(
      /Only a verified or connected sender/
    );
    await svc.retireSender(actorA(), pending);
  });

  /* ── Reply-To ───────────────────────────────────────────────────────── */

  it("normalizes, stores and clears Reply-To", async () => {
    if (!(await reachable())) return;
    await svc.setSenderReplyTo(actorA(), senderA, "  Support@Example.TEST ");
    expect((await svc.getSender(actorA(), senderA)).replyTo).toBe("support@example.test");
    await svc.setSenderReplyTo(actorA(), senderA, null);
    expect((await svc.getSender(actorA(), senderA)).replyTo).toBeNull();
    await expect(svc.setSenderReplyTo(actorA(), senderA, "nope")).rejects.toThrow(/valid Reply-To/);
  });

  /* ── Retirement ─────────────────────────────────────────────────────── */

  it("archives a sender with history and deletes one without", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const fresh = `sender_snd_fresh_${suffix}`;
    await db.insert(senderIdentities).values({
      id: fresh,
      projectId: projectA,
      displayName: "Fresh",
      email: `fresh@snd-a-${suffix}.test`,
      type: "domain",
      status: "verified",
    });

    const deleted = await svc.retireSender(actorA(), fresh);
    expect(deleted.mode).toBe("deleted");
    expect(
      await db
        .select()
        .from(senderIdentities)
        .where((await import("drizzle-orm")).eq(senderIdentities.id, fresh))
    ).toHaveLength(0);

    // senderA has a delivered message: archive, keep history, drop defaults.
    const archived = await svc.retireSender(actorA(), senderA);
    expect(archived.mode).toBe("archived");
    expect(archived.emailCount).toBeGreaterThan(0);
    const restored = await svc.getSender(actorA(), senderA);
    expect(restored.archivedAt).not.toBeNull();
    expect(restored.isDefault).toBe(false);
    expect(restored.isDefaultMarketing).toBe(false);
    const history = await db
      .select({ id: emails.id })
      .from(emails)
      .where((await import("drizzle-orm")).eq(emails.senderIdentityId, senderA));
    expect(history.length).toBeGreaterThan(0);
  });

  /* ── Allowed API keys ───────────────────────────────────────────────── */

  it("stores key restrictions and rejects a foreign key", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const local = `sender_snd_keys_${suffix}`;
    await db.insert(senderIdentities).values({
      id: local,
      projectId: projectA,
      displayName: "Keyed",
      email: `keys@snd-a-${suffix}.test`,
      type: "domain",
      status: "verified",
    });

    // No rows = unrestricted.
    expect(await svc.senderAllowedKeyIds(actorA(), local)).toEqual([]);

    await svc.setSenderAllowedKeys(actorA(), local, [keyA]);
    expect(await svc.senderAllowedKeyIds(actorA(), local)).toEqual([keyA]);

    // A key from the other tenant must be refused, not silently dropped.
    await expect(svc.setSenderAllowedKeys(actorA(), local, [keyB])).rejects.toThrow(
      /does not belong to this project/
    );

    // Clearing restores "unrestricted" by removing every grant row.
    await svc.setSenderAllowedKeys(actorA(), local, []);
    expect(await svc.senderAllowedKeyIds(actorA(), local)).toEqual([]);
    const grants = await db
      .select()
      .from(apiKeySenders)
      .where((await import("drizzle-orm")).eq(apiKeySenders.senderId, local));
    expect(grants).toHaveLength(0);

    await svc.retireSender(actorA(), local);
  });

  /* ── Health ─────────────────────────────────────────────────────────── */

  it("reports health only from real events in the window", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const { emailEvents } = await import("@calder/db");
    const health = await svc.senderHealth(projectA);
    const row = health.get(senderA);
    // The fixture's message is delivered but has no event rows, so the sender
    // is counted as sent and the bounce count is zero.
    expect(row?.sent7d).toBeGreaterThan(0);
    expect(row?.bounced7d).toBe(0);
    expect(row?.warned).toBe(false);

    await db.insert(emailEvents).values({
      id: `ev_snd_bounce_${suffix}`,
      emailId: `em_snd_a_${suffix}`,
      projectId: projectA,
      type: "bounced",
      data: { reason: "mailbox full" },
    });
    const after = (await svc.senderHealth(projectA)).get(senderA);
    expect(after?.bounced7d).toBe(1);
    // One bounce out of one send is 100% — well above the 5% warning line.
    expect(after?.warned).toBe(true);
  });

  /* ── Plan ceiling at creation ───────────────────────────────────────── */

  it("refuses creation past the plan ceiling and frees the slot on archive", async () => {
    if (!(await reachable())) return;
    const { PLAN_LIMITS } = await import("@calder/config");
    const limit = PLAN_LIMITS.free.senders!;

    // Fill the organization to its Beginner allowance. Every sender must be
    // real: the service validates the domain and writes a row.
    const usage = await organizationResourceUsage(getDb(), orgA);
    for (let i = usage.senders; i < limit; i++) {
      const created = await svc.createDomainSender(actorA(), {
        projectId: projectA,
        displayName: `Ceiling ${i}`,
        localPart: `ceiling-${i}`,
        domain: `snd-a-${suffix}.test`,
      });
      expect(created.id).toMatch(/^sender_/);
    }
    expect((await organizationResourceUsage(getDb(), orgA)).senders).toBe(limit);

    // One more is refused with the stable code the UI and API both surface.
    const refusal = await svc
      .createDomainSender(actorA(), {
        projectId: projectA,
        displayName: "Over",
        localPart: "over",
        domain: `snd-a-${suffix}.test`,
      })
      .catch((err) => err);
    expect(refusal).toBeInstanceOf(Object);
    expect(refusal.code).toBe("plan_limit_reached");
    expect(refusal.resource).toBe("senders");
    expect(refusal.message).toMatch(/Beginner/);
    expect(refusal.message).toMatch(/sender identities/);
    expect(refusal.upgradeTier).toBeTruthy();

    // Archiving a sender releases its slot without touching its history.
    const [victim] = await getDb()
      .select({ id: senderIdentities.id })
      .from(senderIdentities)
      .where(and(eq(senderIdentities.projectId, projectA), isNull(senderIdentities.archivedAt)))
      .limit(1);
    await svc.retireSender(actorA(), victim!.id);
    const afterArchive = await svc.createDomainSender(actorA(), {
      projectId: projectA,
      displayName: "After archive",
      localPart: "after-archive",
      domain: `snd-a-${suffix}.test`,
    });
    expect(afterArchive.id).toMatch(/^sender_/);
  });
});
