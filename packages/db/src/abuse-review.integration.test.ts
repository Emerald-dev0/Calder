import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The abuse review queue, against a real Postgres.
 *
 * Before this, an operator could suspend or resume a workspace and nothing
 * else: no list of what needed looking at, no place to write down why, and no
 * way to tell a policy pause from a human decision. These cases pin the three
 * promises: the queue is the right set of workspaces, a decision cannot be
 * recorded without a reason, and every decision is attributed and reversible.
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

const DAY_MS = 24 * 60 * 60 * 1000;

gate("abuse review (live Postgres)", () => {
  const suffix = randomBytes(4).toString("hex");
  const now = new Date();

  const user = `usr_abuse_rev_${suffix}`;
  const orgPaused = `org_abuse_rev_paused_${suffix}`;
  const orgSuspended = `org_abuse_rev_susp_${suffix}`;
  const orgWatching = `org_abuse_rev_watch_${suffix}`;
  const orgHealthy = `org_abuse_rev_ok_${suffix}`;
  const orgOldComplaint = `org_abuse_rev_old_${suffix}`;

  const projectOf = (org: string) => `proj_abuse_rev_${org}_${suffix}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const { getDb, users, organizations, projects, emails } = await import("./index.js");
    const db = getDb();

    await db.insert(users).values({ id: user, email: `abuse-review-${suffix}@test.test` });
    await db.insert(organizations).values([
      {
        id: orgPaused,
        name: "Paused Co",
        slug: `abuse-paused-${suffix}`,
        sendingStatus: "abuse_paused",
        sendingStatusReason: "complaint rate 0.08",
        sendingStatusAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
      {
        id: orgSuspended,
        name: "Suspended Co",
        slug: `abuse-susp-${suffix}`,
        sendingStatus: "suspended",
        sendingStatusReason: "phishing reports",
        sendingStatusAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      },
      { id: orgWatching, name: "Watching Co", slug: `abuse-watch-${suffix}` },
      { id: orgHealthy, name: "Healthy Co", slug: `abuse-ok-${suffix}` },
      { id: orgOldComplaint, name: "Old Complaint Co", slug: `abuse-old-${suffix}` },
    ]);

    await db.insert(projects).values(
      [orgPaused, orgSuspended, orgWatching, orgHealthy, orgOldComplaint].map((org) => ({
        id: projectOf(org),
        organizationId: org,
        name: "P",
        slug: `p-${suffix}`,
      }))
    );

    const mail = (
      org: string,
      status: "sent" | "bounced" | "complained",
      at: Date,
      index: number
    ) => ({
      id: `eml_abuse_rev_${org}_${index}_${suffix}`,
      projectId: projectOf(org),
      from: "hello@calder.test",
      to: `recipient-${index}-${suffix}@example.test`,
      subject: "Hello",
      status,
      createdAt: at,
    });

    const rows = [] as ReturnType<typeof mail>[];
    // Paused: 10 accepted in the window, one hard bounce, one complaint.
    for (let i = 0; i < 8; i++)
      rows.push(mail(orgPaused, "sent", new Date(now.getTime() - i * 60_000), i));
    rows.push(mail(orgPaused, "bounced", new Date(now.getTime() - 60_000), 90));
    rows.push(mail(orgPaused, "complained", new Date(now.getTime() - 120_000), 91));
    // Watching: still sending, one recent complaint.
    rows.push(mail(orgWatching, "sent", new Date(now.getTime() - 6 * 60 * 60 * 1000), 1));
    rows.push(mail(orgWatching, "complained", new Date(now.getTime() - 5 * 60 * 60 * 1000), 2));
    // Healthy: plenty of mail, no complaints.
    for (let i = 0; i < 5; i++)
      rows.push(mail(orgHealthy, "sent", new Date(now.getTime() - i * 60_000), i));
    // Old complaint: outside the 7-day window.
    rows.push(mail(orgOldComplaint, "complained", new Date(now.getTime() - 30 * DAY_MS), 1));

    await db.insert(emails).values(rows);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const { getDb, cleanupSuiteOrg, users } = await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    for (const org of [orgPaused, orgSuspended, orgWatching, orgHealthy, orgOldComplaint]) {
      await cleanupSuiteOrg(db, org).catch(() => undefined);
    }
    await db.delete(users).where(eq(users.id, user));
  });

  it("queues paused, suspended and noisy workspaces — and only those", async () => {
    if (!(await reachable())) return;
    const { getDb, listAbuseReviewQueue } = await import("./index.js");
    const queue = await listAbuseReviewQueue(getDb(), { now, windowDays: 7, limit: 200 });
    const ids = queue.map((entry) => entry.organizationId);

    expect(ids).toContain(orgPaused);
    expect(ids).toContain(orgSuspended);
    expect(ids).toContain(orgWatching);
    expect(ids).not.toContain(orgHealthy);
    expect(ids).not.toContain(orgOldComplaint);

    const paused = queue.find((entry) => entry.organizationId === orgPaused)!;
    expect(paused.reason).toBe("auto_paused");
    expect(paused.status).toBe("abuse_paused");
    expect(paused.statusReason).toBe("complaint rate 0.08");

    const watching = queue.find((entry) => entry.organizationId === orgWatching)!;
    expect(watching.reason).toBe("watching");
    expect(watching.status).toBe("active");
  });

  it("reports the metrics the decision is based on", async () => {
    if (!(await reachable())) return;
    const { getDb, listAbuseReviewQueue } = await import("./index.js");
    const queue = await listAbuseReviewQueue(getDb(), { now, windowDays: 7, limit: 200 });
    const paused = queue.find((entry) => entry.organizationId === orgPaused)!;

    expect(paused.metrics.sent).toBe(10);
    expect(paused.metrics.bounced).toBe(1);
    expect(paused.metrics.complained).toBe(1);
    expect(paused.metrics.bounceRate).toBeCloseTo(0.1, 5);
    expect(paused.metrics.complaintRate).toBeCloseTo(0.1, 5);
  });

  it("puts suspensions ahead of policy pauses", async () => {
    if (!(await reachable())) return;
    const { getDb, listAbuseReviewQueue } = await import("./index.js");
    const queue = await listAbuseReviewQueue(getDb(), { now, windowDays: 7, limit: 200 });
    const ours = queue
      .map((entry) => entry.organizationId)
      .filter((id) => [orgPaused, orgSuspended, orgWatching].includes(id));
    expect(ours.indexOf(orgSuspended)).toBeLessThan(ours.indexOf(orgPaused));
    expect(ours.indexOf(orgPaused)).toBeLessThan(ours.indexOf(orgWatching));
  });

  it("refuses a decision with no note and changes nothing", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision, organizations } = await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    await expect(
      applyAbuseReviewDecision(db, {
        organizationId: orgPaused,
        action: "reinstate",
        note: "ok",
        actorUserId: user,
        now,
      })
    ).rejects.toMatchObject({ code: "note_required" });

    const [row] = await db
      .select({ status: organizations.sendingStatus })
      .from(organizations)
      .where(eq(organizations.id, orgPaused));
    expect(row?.status).toBe("abuse_paused");
  });

  it("records who reinstated a workspace and why", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision, checkProjectSendingEligibility, auditLogs } =
      await import("./index.js");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();

    const result = await applyAbuseReviewDecision(db, {
      organizationId: orgPaused,
      action: "reinstate",
      note: "checked the send log: one purchased list, customer confirmed opt-in",
      actorUserId: user,
      now,
    });
    expect(result).toMatchObject({ changed: true, from: "abuse_paused", to: "active" });

    const eligible = await checkProjectSendingEligibility(db, projectOf(orgPaused), {
      phase: "ingest",
      now,
    });
    expect(eligible.reason).not.toBe("organization_abuse_paused");

    const [audit] = await db
      .select({
        action: auditLogs.action,
        actorUserId: auditLogs.actorUserId,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgPaused),
          eq(auditLogs.action, "organization.sending.reinstated")
        )
      )
      .limit(1);
    expect(audit?.actorUserId).toBe(user);
    expect(audit?.metadata?.from).toBe("abuse_paused");
    expect(audit?.metadata?.to).toBe("active");
    expect(audit?.metadata?.note).toContain("checked the send log");
  });

  it("is idempotent — repeating the current verdict writes no second decision", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision, auditLogs } = await import("./index.js");
    const { and, count, eq } = await import("drizzle-orm");
    const db = getDb();

    const result = await applyAbuseReviewDecision(db, {
      organizationId: orgPaused,
      action: "reinstate",
      note: "second click from the same operator",
      actorUserId: user,
      now,
    });
    expect(result.changed).toBe(false);

    const [rows] = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgPaused),
          eq(auditLogs.action, "organization.sending.reinstated")
        )
      );
    expect(Number(rows?.value ?? 0)).toBe(1);
  });

  it("pausing stops sending without revoking keys", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision, checkProjectSendingEligibility, apiKeys } =
      await import("./index.js");
    const { and, eq, isNull } = await import("drizzle-orm");
    const db = getDb();

    await db.insert(apiKeys).values({
      id: `key_abuse_rev_${suffix}`,
      projectId: projectOf(orgPaused),
      name: "still valid",
      keyPrefix: `calder_sk_live_${suffix.slice(0, 4)}`,
      keyHash: `hash-abuse-rev-${suffix}`,
      env: "live",
    });

    const result = await applyAbuseReviewDecision(db, {
      organizationId: orgPaused,
      action: "pause",
      note: "complaint spike after a purchased list; keys left in place for the customer's reply",
      actorUserId: user,
      now,
    });
    expect(result).toMatchObject({ changed: true, to: "abuse_paused", revokedKeyCount: 0 });

    const eligible = await checkProjectSendingEligibility(db, projectOf(orgPaused), {
      phase: "ingest",
      now,
    });
    expect(eligible.allowed).toBe(false);
    expect(eligible.reason).toBe("organization_abuse_paused");

    const live = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, projectOf(orgPaused)), isNull(apiKeys.revokedAt)));
    expect(live.length).toBe(1);
  });

  it("suspending revokes every live key and says how many", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision, apiKeys } = await import("./index.js");
    const { and, eq, isNull } = await import("drizzle-orm");
    const db = getDb();

    await db.insert(apiKeys).values({
      id: `key_abuse_rev2_${suffix}`,
      projectId: projectOf(orgPaused),
      name: "second",
      keyPrefix: `calder_sk_live_${suffix.slice(0, 4)}b`,
      keyHash: `hash-abuse-rev2-${suffix}`,
      env: "live",
    });

    const result = await applyAbuseReviewDecision(db, {
      organizationId: orgPaused,
      action: "suspend",
      note: "confirmed phishing: the template links to a credential page",
      actorUserId: user,
      now,
    });
    expect(result.changed).toBe(true);
    expect(result.to).toBe("suspended");
    expect(result.revokedKeyCount).toBe(2);

    const live = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, projectOf(orgPaused)), isNull(apiKeys.revokedAt)));
    expect(live).toEqual([]);
  });

  it("keeps a note that changes nothing, and shows the whole history newest first", async () => {
    if (!(await reachable())) return;
    const { getDb, addAbuseReviewNote, abuseReviewHistory, organizations } =
      await import("./index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();

    const at = new Date(now.getTime() + 60_000);
    await addAbuseReviewNote(db, {
      organizationId: orgSuspended,
      note: "customer replied: they are rotating keys and filing a takedown",
      actorUserId: user,
      now: at,
    });

    const [row] = await db
      .select({ status: organizations.sendingStatus })
      .from(organizations)
      .where(eq(organizations.id, orgSuspended));
    expect(row?.status).toBe("suspended");

    const history = await abuseReviewHistory(db, orgSuspended, 10);
    expect(history[0]?.action).toBe("organization.abuse.note");
    expect(history[0]?.note).toContain("rotating keys");
    expect(history[0]?.actorUserId).toBe(user);
  });

  it("refuses an unknown workspace", async () => {
    if (!(await reachable())) return;
    const { getDb, applyAbuseReviewDecision } = await import("./index.js");
    await expect(
      applyAbuseReviewDecision(getDb(), {
        organizationId: `org_missing_${suffix}`,
        action: "pause",
        note: "should not exist",
        actorUserId: user,
        now,
      })
    ).rejects.toMatchObject({ code: "not_found", statusCode: 404 });
  });

  it("knows which roles may enforce", async () => {
    if (!(await reachable())) return;
    const { canEnforceAbuseReview } = await import("./index.js");
    expect(canEnforceAbuseReview("founder")).toBe(true);
    expect(canEnforceAbuseReview("security")).toBe(true);
    expect(canEnforceAbuseReview("support")).toBe(false);
    expect(canEnforceAbuseReview("analyst")).toBe(false);
    expect(canEnforceAbuseReview(null)).toBe(false);
  });
});
