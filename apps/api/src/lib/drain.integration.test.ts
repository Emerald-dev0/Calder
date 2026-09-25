import { describe, it, expect, beforeAll, afterAll } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("@calder/db");
    const { sql } = await import("drizzle-orm");
    const db = getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 0, M0.2 drain safety:
 * - overlapping drains claim disjoint rows (FOR UPDATE SKIP LOCKED lease),
 *   so one email is sent exactly once no matter how many drains run
 * - a suppressed recipient never reaches the provider
 * - future-scheduled rows are not claimed early
 */
gate("delivery drain lease (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    emailEvents,
    suppressions,
  } = await import("@calder/db");
  const { eq, and, inArray, count, ne } = await import("drizzle-orm");
  const { drainPendingEmails } = await import("./drain.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_drn_${suffix}`;
  const projId = `proj_drn_${suffix}`;
  const userId = `usr_drn_${suffix}`;
  const emailIds: string[] = [];

  const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  async function seedQueued(to: string, opts: { scheduledFor?: Date } = {}) {
    const db = getDb();
    const id = rid("em");
    await db.insert(emails).values({
      id,
      projectId: projId,
      from: `drn-${suffix}@test.test`,
      to,
      subject: "drain test",
      text: "hello",
      status: "queued",
      attemptCount: 0,
      ...(opts.scheduledFor ? { scheduledFor: opts.scheduledFor } : {}),
    });
    emailIds.push(id);
    return id;
  }

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `drn-user-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Drain Test", slug: `drn-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_drn_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("two overlapping drains send each email exactly once", async () => {
    if (!(await reachable())) return;
    const count_ = 10;
    const ids: string[] = [];
    for (let i = 0; i < count_; i++) {
      ids.push(await seedQueued(`ov-${i}-${suffix}@example.test`));
    }

    // Overlap on purpose, this used to double-send.
    const [a, b] = await Promise.all([drainPendingEmails(), drainPendingEmails()]);

    // The drain is global: it claims whatever is queued, including rows other
    // suites created in parallel (turbo runs packages concurrently against one
    // database), so these counters only lower-bound our own ten. The
    // exactly-once proof is per-id, below, which is immune to other traffic.
    expect(a.checked + b.checked).toBeGreaterThanOrEqual(count_);
    expect(a.sent + b.sent).toBeGreaterThanOrEqual(count_);

    const db = getDb();
    // Our rows may have been left unclaimed only because a concurrent suite
    // filled the batch: drain again until they settle, bounded.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [pending] = await db
        .select({ value: count() })
        .from(emails)
        .where(and(inArray(emails.id, ids), ne(emails.status, "sent")));
      if (Number(pending?.value ?? 0) === 0) break;
      await drainPendingEmails();
    }

    const rows = await db
      .select({ id: emails.id, status: emails.status })
      .from(emails)
      .where(inArray(emails.id, ids));
    expect(rows.every((r) => r.status === "sent")).toBe(true);

    // Exactly one "sent" event per email.
    const events = await db
      .select({ emailId: emailEvents.emailId, value: count() })
      .from(emailEvents)
      .where(and(inArray(emailEvents.emailId, ids), eq(emailEvents.type, "sent")))
      .groupBy(emailEvents.emailId);
    expect(events.length).toBe(count_);
    expect(events.every((e) => Number(e.value) === 1)).toBe(true);
  });

  it("a suppressed recipient is marked suppressed, never sent", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const to = `sup-drn-${suffix}@example.test`;
    await db.insert(suppressions).values({
      id: rid("sup"),
      projectId: projId,
      email: to,
      reason: "manual",
    });
    const id = await seedQueued(to);

    const result = await drainPendingEmails();
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
    expect(row?.status).toBe("suppressed");
    const ev = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, id), eq(emailEvents.type, "sent")));
    expect(Number(ev[0]?.value)).toBe(0);
  });

  it("future-scheduled rows are not claimed before their time", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const { claimDrainBatch } = await import("./drain.js");
    const futureId = await seedQueued(`later-${suffix}@example.test`, {
      scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    });

    const claimed = await claimDrainBatch(db, 1000);
    expect(claimed.map((r) => r.id)).not.toContain(futureId);

    const [row] = await db
      .select({ status: emails.status })
      .from(emails)
      .where(eq(emails.id, futureId))
      .limit(1);
    expect(row?.status).toBe("queued");

    // Anything the claim batch picked up (other tests' leftovers) gets
    // released back to queued so nothing in this suite is stranded.
    const { inArray: inArr } = await import("drizzle-orm");
    if (claimed.length > 0) {
      await db
        .update(emails)
        .set({ status: "queued" })
        .where(
          inArr(
            emails.id,
            claimed.map((r) => r.id)
          )
        );
    }
  });
});
