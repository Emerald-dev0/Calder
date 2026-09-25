import { describe, it, expect, beforeAll, afterAll } from "vitest";

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
 * M2.5 abuse watch + M2.4 transport state (live Postgres):
 * - hourly velocity LIMIT refuses the leg transiently (row requeued, not sent)
 * - hourly velocity SUSPEND flips the transport once (audited once) and
 *   fails the row loud, with a message that names the remedy
 * - warn velocity writes a debounced audit row but still lets mail run
 * The velocity check runs BEFORE credential decryption, so no real Gmail
 * credentials are needed for any of these scenarios.
 */
gate("gmail abuse watch (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    projectTransports,
    auditLogs,
  } = await import("@calder/db");
  const { eq, and, count, sql } = await import("drizzle-orm");
  const { drainPendingEmails } = await import("./drain.js");

  const suffix = randomBytes(4).toString("hex");
  const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const orgId = `org_gw_${suffix}`;
  const projId = `proj_gw_${suffix}`;
  const userId = `usr_gw_${suffix}`;
  const transportId = `ptr_gw_${suffix}`;

  async function seedGmailHistory(n: number, withinMinutes = 30) {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO emails (id, project_id, "from", "to", subject, text, status, transport, created_at)
      SELECT ${rid("em_gw")} || '_' || g, ${projId}, 'gw@test.test', 'r@test.test', 'hist', 'x', 'sent', 'gmail',
             now() - (random() * ${withinMinutes} || ' minutes')::interval
      FROM generate_series(1, ${n}) AS g
    `);
  }

  /**
   * Drain until OUR row has been claimed at least once.
   *
   * The drain is global: on a shared database (CI runs packages concurrently
   * against one Postgres) a first batch can be entirely filled by other
   * suites' queued rows, so a single call can leave ours untouched and every
   * assertion below becomes a coin flip. Stop at the first claim — a
   * velocity-refused row is requeued on purpose, so draining until "not
   * queued" would burn its retry budget and change what the test observes.
   */
  async function drainUntilSettled(emailId: string, attempts = 6) {
    const db = getDb();
    let row: typeof emails.$inferSelect | undefined;
    for (let i = 0; i < attempts; i++) {
      await drainPendingEmails(getDb(), { batch: 20 });
      [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (row && row.attemptCount >= 1) return row;
    }
    return row;
  }

  async function queueOne() {
    const db = getDb();
    const id = rid("em_gwq");
    await db.insert(emails).values({
      id,
      projectId: projId,
      from: `gw-${suffix}@test.test`,
      to: "r@test.test",
      subject: "watch probe",
      text: "x",
      status: "queued",
      attemptCount: 0,
    });
    return id;
  }

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `gw-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "GW", slug: `gw-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_gw_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    await db.insert(projectTransports).values({
      id: transportId,
      projectId: projId,
      type: "gmail",
      label: "gw-gmail@test.test",
      status: "active",
      isDefault: true,
      encryptedCredentials: { iv: "AA==", ciphertext: "AA==", tag: "AA==" },
      dailyCap: 10_000, // keep the daily cap above all velocity probes
    });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("sender pinning: the identity's own transport leg is chosen first (M2.4)", async () => {
    const db = getDb();
    const { senderIdentities } = await import("@calder/db");
    // Default transport is healthy-looking; the PINNED one trips its cap
    // immediately. `lastError` tells us which leg ran first.
    const pinnedTransportId = `ptr_pin_${suffix}`;
    await db.insert(projectTransports).values({
      id: pinnedTransportId,
      projectId: projId,
      type: "gmail",
      label: "pinned@test.test",
      status: "active",
      isDefault: false,
      encryptedCredentials: { iv: "AA==", ciphertext: "AA==", tag: "AA==" },
      dailyCap: 0, // forces gmail_cap the moment the PINNED leg is built
    });
    const senderId = `snd_pin_${suffix}`;
    await db.insert(senderIdentities).values({
      id: senderId,
      projectId: projId,
      email: `pin-${suffix}@test.test`,
      displayName: "Pin Test",
      type: "gmail",
      status: "connected",
      transportId: pinnedTransportId,
    });
    const id = rid("em_pin");
    await db.insert(emails).values({
      id,
      projectId: projId,
      from: `pin-${suffix}@test.test`,
      senderIdentityId: senderId,
      to: "r@test.test",
      subject: "pinning probe",
      text: "x",
      status: "queued",
      attemptCount: 0,
    });
    const row = await drainUntilSettled(id);
    expect(row?.status).toBe("failed");
    expect(row?.lastError ?? "").toMatch(/Gmail daily cap reached/i);
    await db.delete(senderIdentities).where(eq(senderIdentities.id, senderId));
    await db.delete(projectTransports).where(eq(projectTransports.id, pinnedTransportId));
  }, 60_000);

  it("warn velocity: audit row recorded (debounced), mail flow not refused", async () => {
    const db = getDb();
    // GMAIL_WATCH defaults: warn 40/h, limit 120/h, suspend 600/h.
    await seedGmailHistory(45); // past warn, below limit
    const id = await queueOne();
    const row = await drainUntilSettled(id);
    // Mail was NOT refused by the watch (leg either delivered via fallback
    // error or requeued for the junk-credential construction error — the
    // important bit: no velocity refusal text).
    expect(row?.lastError ?? "").not.toMatch(/velocity limit|suspended/i);

    const warnRows = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "transport.gmail_velocity_warn"),
          eq(auditLogs.targetId, transportId)
        )
      );
    expect(Number(warnRows[0]?.value ?? 0)).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("hourly limit: mail refused transiently, row stays retryable", async () => {
    const db = getDb();
    await seedGmailHistory(120); // at/above limit in the last hour
    const id = await queueOne();
    const row = await drainUntilSettled(id);
    expect(row?.status).not.toBe("sent");
    expect(row?.lastError ?? "").toMatch(/velocity limit reached/i);
    const [t] = await db
      .select({ status: projectTransports.status })
      .from(projectTransports)
      .where(eq(projectTransports.id, transportId))
      .limit(1);
    expect(t?.status).toBe("active"); // limit does NOT suspend
  }, 60_000);

  it("suspend velocity: transport flips once (audited once), row fails with the remedy", async () => {
    const db = getDb();
    await seedGmailHistory(620); // >= suspend line
    const id = await queueOne();
    // Our row must be the one that settles; the transport flips as a side
    // effect of processing it.
    const row = await drainUntilSettled(id);
    expect(row?.status).toBe("failed");

    const [t] = await db
      .select({ status: projectTransports.status })
      .from(projectTransports)
      .where(eq(projectTransports.id, transportId))
      .limit(1);
    expect(t?.status).toBe("suspended");
    expect(row?.lastError ?? "").toMatch(/suspended for abuse-pattern/i);

    // Exactly one suspend audit row — re-draining must not spam the trail.
    const auditRows = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, "transport.gmail_suspended"), eq(auditLogs.targetId, transportId))
      );
    expect(Number(auditRows[0]?.value ?? 0)).toBe(1);

    // Already-suspended transports are skipped by chain resolution (status
    // filter), so re-running a send cannot resurrect the leg or spam audits.
    const id2 = await queueOne();
    const row2 = await drainUntilSettled(id2);
    expect(row2?.transport ?? "").not.toBe("gmail");
    const auditRows2 = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, "transport.gmail_suspended"), eq(auditLogs.targetId, transportId))
      );
    expect(Number(auditRows2[0]?.value ?? 0)).toBe(1);
  }, 60_000);
});
