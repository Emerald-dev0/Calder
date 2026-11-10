import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * Round 5, workstream 3: queue acceptance scenarios against real PostgreSQL.
 *
 * These tests use the production claim/lease/repair code. They do NOT prove a
 * deployed scheduler or a real provider; that is recorded separately in
 * docs/ROUND-5-HANDOFF.md.
 */
gate("queue delivery reliability (live Postgres)", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_r5_${suffix}`;
  const projectId = `proj_r5_${suffix}`;
  const userId = `usr_r5_${suffix}`;
  const workerPrefix = `r5_${suffix}`;

  let db: Awaited<ReturnType<typeof import("@calder/db").getDb>>;
  let mod: typeof import("@calder/db");
  let processor: typeof import("./processor.js");
  let drain: typeof import("./drain.js");

  async function seedEmail(
    opts: {
      scheduledFor?: Date | null;
      nextAttemptAt?: Date | null;
      status?: "queued" | "created";
    } = {}
  ): Promise<string> {
    const id = `em_r5_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await db.insert(mod.emails).values({
      id,
      projectId,
      from: `r5-${suffix}@test.test`,
      to: `r5-${suffix}@example.test`,
      subject: "r5",
      text: "r5",
      status: opts.status ?? "queued",
      scheduledFor: opts.scheduledFor ?? null,
      nextAttemptAt: opts.nextAttemptAt ?? null,
    });
    return id;
  }

  beforeAll(async () => {
    db = (await import("@calder/db")).getDb();
    mod = await import("@calder/db");
    processor = await import("./processor.js");
    drain = await import("./drain.js");
    await db.insert(mod.users).values({ id: userId, email: `r5-${suffix}@test.test` });
    await db.insert(mod.organizations).values({ id: orgId, name: "R5", slug: `r5-${suffix}` });
    await db.insert(mod.organizationMembers).values({
      id: `orgm_r5_${suffix}`,
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db
      .insert(mod.projects)
      .values({ id: projectId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    await mod.cleanupSuiteOrg(db, orgId, userId);
    await db
      .delete(mod.queueProcessorRuns)
      .where(sql`${mod.queueProcessorRuns.workerId} like ${`${workerPrefix}%`}`);
    await mod.closeDb();
  });

  it("discovers due scheduled mail with no traffic, never early (UTC semantics)", async () => {
    const due = await seedEmail({ scheduledFor: new Date(Date.now() - 60_000) });
    // Explicit offset proves the value is stored as an instant, not parsed as
    // "local wall clock": this is one hour in the future in UTC.
    const future = await seedEmail({
      scheduledFor: new Date(new Date(Date.now() + 3_600_000).toISOString().replace("Z", "+00:00")),
    });

    const summary = await processor.runQueueProcessor(db, {
      trigger: "test",
      workerId: `${workerPrefix}_discover`,
      maxJobs: 10,
    });
    expect(summary.status).toBe("completed");

    const rows = await db
      .select({ id: mod.emails.id, status: mod.emails.status })
      .from(mod.emails)
      .where(inArray(mod.emails.id, [due, future]));
    expect(rows.find((r) => r.id === due)?.status).toBe("sent");
    expect(rows.find((r) => r.id === future)?.status).toBe("queued");

    const futureJobs = await db
      .select({ id: mod.jobs.id })
      .from(mod.jobs)
      .where(
        and(eq(mod.jobs.jobType, "email.send"), sql`${mod.jobs.payload}->>'emailId' = ${future}`)
      );
    expect(futureJobs).toHaveLength(0);

    const [run] = await db
      .select()
      .from(mod.queueProcessorRuns)
      .where(eq(mod.queueProcessorRuns.id, summary.runId));
    expect(run?.status).toBe("completed");
    expect(run?.trigger).toBe("test");
    expect(run?.finishedAt).not.toBeNull();
  });

  it("respects retry backoff for email rows and retries after eligibility", async () => {
    const id = await seedEmail({ nextAttemptAt: new Date(Date.now() + 60_000) });
    const first = await drain.drainPendingEmails(db, { batch: 50 });
    expect(first.sent).toBeGreaterThanOrEqual(0);
    let [row] = await db.select().from(mod.emails).where(eq(mod.emails.id, id));
    expect(row?.status).toBe("queued");
    expect(row?.attemptCount).toBe(0);

    await db
      .update(mod.emails)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.emails.id, id));
    await drain.drainPendingEmails(db, { batch: 50 });
    [row] = await db.select().from(mod.emails).where(eq(mod.emails.id, id));
    expect(row?.status).toBe("sent");
  });

  it("does not claim a job before available_at and makes retry eligible automatically", async () => {
    const job = await mod.enqueueJob(db, {
      type: "billing.maintenance",
      payload: { suite: suffix, case: "backoff" },
      accountId: orgId,
      maxAttempts: 3,
      delayMs: 60_000,
      idempotencyKey: `r5-delay-${suffix}`,
    });
    const early = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_early`,
      types: ["billing.maintenance"],
      limit: 100,
    });
    expect(early.some((j) => j.id === job.id)).toBe(false);

    await db
      .update(mod.jobs)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.jobs.id, job.id));
    const [claimed] = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_retry1`,
      types: ["billing.maintenance"],
    });
    expect(claimed?.id).toBe(job.id);
    const retried = await mod.failJob(db, {
      id: job.id,
      workerId: `${workerPrefix}_retry1`,
      error: "transient",
      retryable: true,
    });
    expect(retried.status).toBe("pending");
    expect(retried.availableAt!.getTime()).toBeGreaterThan(Date.now());

    const tooSoon = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_retry2`,
      types: ["billing.maintenance"],
    });
    expect(tooSoon.some((j) => j.id === job.id)).toBe(false);

    await db
      .update(mod.jobs)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.jobs.id, job.id));
    const [again] = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_retry3`,
      types: ["billing.maintenance"],
    });
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
    await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_retry3` });
  });

  it("recovers work from a crashed processor's expired lease", async () => {
    const job = await mod.enqueueJob(db, {
      type: "billing.maintenance",
      payload: { suite: suffix, case: "lease" },
      accountId: orgId,
      idempotencyKey: `r5-lease-${suffix}`,
    });
    const [claimed] = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_crash`,
      types: ["billing.maintenance"],
      leaseSeconds: 5,
    });
    expect(claimed?.id).toBe(job.id);
    // Simulate a process that died: its lease expires, nobody completes it.
    await db
      .update(mod.jobs)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(mod.jobs.id, job.id));
    const reaped = await mod.reapExpiredLeases(db);
    expect(reaped).toBeGreaterThanOrEqual(1);
    const [recovered] = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_recovered`,
      types: ["billing.maintenance"],
    });
    expect(recovered?.id).toBe(job.id);
    expect(recovered?.attempts).toBe(2);
    await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_recovered` });
  });

  it("lets concurrent processors run without duplicate claims", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const job = await mod.enqueueJob(db, {
        type: "billing.maintenance",
        payload: { suite: suffix, case: `concurrent-${i}` },
        accountId: orgId,
        idempotencyKey: `r5-conc-${suffix}-${i}`,
      });
      ids.push(job.id);
    }
    await Promise.all([
      processor.runQueueProcessor(db, {
        trigger: "test",
        workerId: `${workerPrefix}_conc_a`,
        maxJobs: 30,
      }),
      processor.runQueueProcessor(db, {
        trigger: "test",
        workerId: `${workerPrefix}_conc_b`,
        maxJobs: 30,
      }),
    ]);
    const rows = await db
      .select({ id: mod.jobs.id, status: mod.jobs.status, attempts: mod.jobs.attempts })
      .from(mod.jobs)
      .where(inArray(mod.jobs.id, ids));
    expect(rows).toHaveLength(20);
    expect(rows.every((r) => r.status === "completed")).toBe(true);
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
  });

  it("stops at its runtime budget and releases unstarted claims", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const job = await mod.enqueueJob(db, {
        type: "billing.maintenance",
        payload: { suite: suffix, case: `budget-${i}` },
        accountId: orgId,
        idempotencyKey: `r5-budget-${suffix}-${i}`,
      });
      ids.push(job.id);
    }
    let tick = 0;
    const summary = await processor.runQueueProcessor(db, {
      trigger: "test",
      workerId: `${workerPrefix}_budget`,
      maxJobs: 25,
      runtimeBudgetMs: 1_000,
      now: () => {
        tick += 1;
        return tick * 600;
      },
    });
    expect(summary.budgetExhausted).toBe(true);
    expect(summary.released).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select({ id: mod.jobs.id, status: mod.jobs.status, attempts: mod.jobs.attempts })
      .from(mod.jobs)
      .where(inArray(mod.jobs.id, ids));
    expect(rows.every((r) => r.status === "pending" || r.status === "completed")).toBe(true);
    expect(rows.every((r) => r.attempts <= 1)).toBe(true);
  });

  it("repairs a missing email wake-up idempotently (no stranded work)", async () => {
    const id = await seedEmail();
    const first = await processor.repairDueEmailJobs(db, 100);
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await processor.repairDueEmailJobs(db, 100);
    expect(second).toBe(0);
    const jobs = await db
      .select({ id: mod.jobs.id })
      .from(mod.jobs)
      .where(and(eq(mod.jobs.jobType, "email.send"), sql`${mod.jobs.payload}->>'emailId' = ${id}`));
    expect(jobs).toHaveLength(1);
    await db
      .update(mod.jobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(mod.jobs.id, jobs[0]!.id));
  });

  it("exposes dead letters, requeues them, and records failed runs", async () => {
    const job = await mod.enqueueJob(db, {
      type: "billing.maintenance",
      payload: { suite: suffix, case: "dead" },
      accountId: orgId,
      maxAttempts: 1,
      priority: 100_000,
      idempotencyKey: `r5-dead-${suffix}`,
    });
    // Claim a wide batch, then hand back everything that is not this case's
    // row: shared-DB leftovers in other suites must not decide what we inspect.
    const batch = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_dead`,
      types: ["billing.maintenance"],
      limit: 100,
    });
    const claimed = batch.find((candidate) => candidate.id === job.id);
    for (const other of batch) {
      if (other.id !== job.id) {
        await mod.releaseClaim(db, { id: other.id, workerId: `${workerPrefix}_dead` });
      }
    }
    expect(claimed?.id).toBe(job.id);
    const failed = await mod.failJob(db, {
      id: job.id,
      workerId: `${workerPrefix}_dead`,
      error: "transient failure, attempts exhausted",
      // Retryable=true with maxAttempts=1 is the dead-letter path; a
      // non-retryable failure is `jobStatus.failed` instead.
      retryable: true,
    });
    expect(failed.status).toBe("dead_letter");

    const dead = await mod.listDeadLetterJobs(db, 200);
    expect(dead.some((j) => j.id === job.id)).toBe(true);
    const requeued = await mod.requeueDeadLetterJob(db, job.id);
    expect(requeued.requeued).toBe(true);
    const [row] = await db.select().from(mod.jobs).where(eq(mod.jobs.id, job.id));
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);

    const runId = await mod.startProcessorRun(db, {
      workerId: `${workerPrefix}_failure`,
      trigger: "test",
    });
    await mod.finishProcessorRun(db, runId, {
      status: "failed",
      claimed: 1,
      completed: 0,
      failed: 1,
      released: 0,
      reapedLeases: 0,
      emailsSent: 0,
      webhooksDelivered: 0,
      webhooksRetried: 0,
      durationMs: 12,
      error: "simulated scheduler failure",
    });
    const runs = await mod.recentProcessorRuns(db, 100);
    const recorded = runs.find((r) => r.id === runId);
    expect(recorded?.status).toBe("failed");
    expect(recorded?.error).toContain("simulated");

    await db.delete(mod.jobs).where(eq(mod.jobs.id, job.id));
  });
});
