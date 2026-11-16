import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Retention, against a real Postgres.
 *
 * `retentionDays` was catalogue data that nothing enforced: every plan page
 * promised 7/14/30/90 days, and Beginner workspaces held bodies forever. This
 * suite pins the three rules that make the sweep safe to run unattended —
 * only finished messages, only past the window, and never on a contract plan
 * with no number.
 */
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

async function reachable(): Promise<boolean> {
  try {
    const { getDb } = await import("./client.js");
    const { sql } = await import("drizzle-orm");
    await getDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

gate("retention sweep (live Postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const orgFree = `org_ret_free_${suffix}`;
  const orgScale = `org_ret_scale_${suffix}`;
  const orgBounded = `org_ret_bound_${suffix}`;
  const userFree = `usr_ret_free_${suffix}`;
  const userScale = `usr_ret_scale_${suffix}`;
  const userBounded = `usr_ret_bound_${suffix}`;
  const projFree = `proj_ret_free_${suffix}`;
  const projScale = `proj_ret_scale_${suffix}`;
  const projBounded = `proj_ret_bound_${suffix}`;
  const planScaleId = `plan_ret_scale_${suffix}`;

  const now = new Date();
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const oldSent = `eml_ret_old_sent_${suffix}`;
  const oldQueued = `eml_ret_old_queued_${suffix}`;
  const oldDeferred = `eml_ret_old_deferred_${suffix}`;
  const recentSent = `eml_ret_recent_sent_${suffix}`;
  const scaleOld = `eml_ret_scale_old_${suffix}`;
  const boundedA = `eml_ret_bound_a_${suffix}`;
  const boundedB = `eml_ret_bound_b_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const {
      getDb,
      plans,
      subscriptions,
      users,
      organizations,
      organizationMembers,
      projects,
      emails,
      emailEvents,
    } = await import("./index.js");
    const db = getDb();

    await db.insert(users).values([
      { id: userFree, email: `ret-free-${suffix}@test.test` },
      { id: userScale, email: `ret-scale-${suffix}@test.test` },
      { id: userBounded, email: `ret-bound-${suffix}@test.test` },
    ]);

    await db.insert(organizations).values([
      { id: orgFree, name: "Retention Free", slug: `ret-free-${suffix}` },
      { id: orgScale, name: "Retention Scale", slug: `ret-scale-${suffix}` },
      { id: orgBounded, name: "Retention Bounded", slug: `ret-bound-${suffix}` },
    ]);

    await db.insert(organizationMembers).values([
      { id: `orgm_ret_free_${suffix}`, organizationId: orgFree, userId: userFree, role: "owner" },
      {
        id: `orgm_ret_scale_${suffix}`,
        organizationId: orgScale,
        userId: userScale,
        role: "owner",
      },
      {
        id: `orgm_ret_bound_${suffix}`,
        organizationId: orgBounded,
        userId: userBounded,
        role: "owner",
      },
    ]);

    await db.insert(projects).values([
      { id: projFree, organizationId: orgFree, name: "Free", slug: "free" },
      { id: projScale, organizationId: orgScale, name: "Scale", slug: "scale" },
      { id: projBounded, organizationId: orgBounded, name: "Bounded", slug: "bounded" },
    ]);

    const body = (projectId: string, id: string, status: string, createdAt: Date) => ({
      id,
      projectId,
      from: "billing@calder.test",
      to: `ada-${suffix}@example.test`,
      cc: "finance@example.test",
      bcc: "archive@example.test",
      subject: `Receipt ${id}`,
      html: "<p>Your receipt is attached.</p>",
      text: "Your receipt is attached.",
      attachments: [{ filename: "receipt.pdf", contentBase64: "JVBERi0=" }],
      metadata: { invoice: "INV-1", customerName: "Ada Lovelace" },
      status: status as "sent",
      createdAt,
    });

    await db
      .insert(emails)
      .values([
        body(projFree, oldSent, "sent", daysAgo(30)),
        body(projFree, oldQueued, "queued", daysAgo(30)),
        body(projFree, oldDeferred, "deferred", daysAgo(30)),
        body(projFree, recentSent, "sent", daysAgo(1)),
        body(projScale, scaleOld, "sent", daysAgo(30)),
        body(projBounded, boundedA, "sent", daysAgo(30)),
        body(projBounded, boundedB, "bounced", daysAgo(40)),
      ]);

    await db.insert(emailEvents).values([
      {
        id: `evt_ret_1_${suffix}`,
        emailId: oldSent,
        projectId: projFree,
        type: "sent",
        createdAt: daysAgo(30),
      },
      {
        id: `evt_ret_2_${suffix}`,
        emailId: oldSent,
        projectId: projFree,
        type: "delivered",
        createdAt: daysAgo(29),
      },
      {
        id: `evt_ret_3_${suffix}`,
        emailId: oldQueued,
        projectId: projFree,
        type: "queued",
        createdAt: daysAgo(30),
      },
      {
        id: `evt_ret_4_${suffix}`,
        emailId: recentSent,
        projectId: projFree,
        type: "sent",
        createdAt: daysAgo(1),
      },
    ]);

    // A contract plan: `retentionDays: null` means "do not touch", not "use a
    // default". Scale is retired, which is exactly the population that has a
    // number-less contract.
    await db
      .insert(plans)
      .values({ id: planScaleId, tier: "scale", name: "Scale" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const { getDb, cleanupSuiteOrg, plans } = await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    await cleanupSuiteOrg(db, orgFree, userFree);
    await cleanupSuiteOrg(db, orgScale, userScale);
    await cleanupSuiteOrg(db, orgBounded, userBounded);
    await db.delete(plans).where(eq(plans.id, planScaleId));
  });

  it("redacts finished messages past the window and deletes their timeline", async () => {
    if (!(await reachable())) return;
    const { getDb, enforceRetention } = await import("./index.js");
    const db = getDb();

    const summary = await enforceRetention(db, now, { organizationIds: [orgFree] });
    expect(summary.failures).toEqual([]);
    expect(summary.organizationsEnforced).toBe(1);
    expect(summary.redacted).toBe(1);
    // Two events on the old delivered message; the queued message's event must
    // survive, because that message can still be sent.
    expect(summary.eventsDeleted).toBe(2);
    expect(summary.truncated).toBe(false);
  });

  it("keeps the accounting row and clears the body", async () => {
    if (!(await reachable())) return;
    const { getDb, emails, RETENTION_SUBJECT_PLACEHOLDER } = await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const [row] = await getDb().select().from(emails).where(eq(emails.id, oldSent)).limit(1);

    expect(row?.subject).toBe(RETENTION_SUBJECT_PLACEHOLDER);
    expect(row?.html).toBeNull();
    expect(row?.text).toBeNull();
    expect(row?.attachments).toBeNull();
    expect(row?.metadata).toBeNull();
    expect(row?.cc).toBeNull();
    expect(row?.bcc).toBeNull();
    // Accounting: status, recipients and timestamps survive, so usage and the
    // customer's own history do not change when a body is removed.
    expect(row?.status).toBe("sent");
    expect(row?.to).toBe(`ada-${suffix}@example.test`);
    expect(row?.createdAt.getTime()).toBe(daysAgo(30).getTime());
  });

  it("leaves messages that could still be sent alone", async () => {
    if (!(await reachable())) return;
    const { getDb, emails, emailEvents } = await import("./index.js");
    const { eq, inArray } = await import("drizzle-orm");
    const db = getDb();

    for (const id of [oldQueued, oldDeferred, recentSent]) {
      const [row] = await db.select().from(emails).where(eq(emails.id, id)).limit(1);
      expect(row?.html).toBe("<p>Your receipt is attached.</p>");
      expect(row?.subject).toBe(`Receipt ${id}`);
    }

    const surviving = await db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(inArray(emailEvents.id, [`evt_ret_3_${suffix}`, `evt_ret_4_${suffix}`]));
    expect(surviving.length).toBe(2);
  });

  it("is idempotent — a second run has nothing left to do", async () => {
    if (!(await reachable())) return;
    const { getDb, enforceRetention } = await import("./index.js");
    const summary = await enforceRetention(getDb(), now, { organizationIds: [orgFree] });
    expect(summary.redacted).toBe(0);
    expect(summary.eventsDeleted).toBe(0);
    expect(summary.results).toEqual([]);
    expect(summary.truncated).toBe(false);
  });

  it("does not touch a contract plan with no retention number", async () => {
    if (!(await reachable())) return;
    const { getDb, enforceRetention, emails, plans, subscriptions } = await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.tier, "scale"));
    expect(plan?.id).toBeTruthy();
    const existing = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgScale));
    if (existing.length === 0) {
      await db.insert(subscriptions).values({
        id: `sub_ret_scale_${suffix}`,
        organizationId: orgScale,
        planId: plan!.id,
        status: "active",
      });
    }

    const summary = await enforceRetention(db, now, { organizationIds: [orgScale] });
    expect(summary.organizationsUnlimited).toBe(1);
    expect(summary.organizationsEnforced).toBe(0);
    expect(summary.redacted).toBe(0);

    const [row] = await db.select().from(emails).where(eq(emails.id, scaleOld)).limit(1);
    expect(row?.html).toBe("<p>Your receipt is attached.</p>");
    expect(row?.metadata).toEqual({ invoice: "INV-1", customerName: "Ada Lovelace" });
  });

  it("stops at its bound and says so, so the next run can finish", async () => {
    if (!(await reachable())) return;
    const { getDb, enforceRetention } = await import("./index.js");
    const db = getDb();

    const first = await enforceRetention(db, now, {
      organizationIds: [orgBounded],
      maxEmailsPerOrganization: 1,
    });
    expect(first.redacted).toBe(1);
    expect(first.truncated).toBe(true);

    const second = await enforceRetention(db, now, {
      organizationIds: [orgBounded],
      maxEmailsPerOrganization: 1,
    });
    expect(second.redacted).toBe(1);

    const third = await enforceRetention(db, now, { organizationIds: [orgBounded] });
    expect(third.redacted).toBe(0);
    expect(third.truncated).toBe(false);
  });

  it("reports what is still past the window for one workspace", async () => {
    if (!(await reachable())) return;
    const { getDb, organizationRetentionStatus } = await import("./index.js");
    const db = getDb();

    const free = await organizationRetentionStatus(db, orgFree, now);
    expect(free.tier).toBe("free");
    expect(free.retentionDays).toBe(7);
    expect(free.pending).toBe(0);

    const contract = await organizationRetentionStatus(db, orgScale, now);
    expect(contract.retentionDays).toBeNull();
    expect(contract.cutoff).toBeNull();
    expect(contract.pending).toBe(0);
  });
});
