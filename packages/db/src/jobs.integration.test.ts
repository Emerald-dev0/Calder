import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { organizations } from "./schema/organizations.js";
import { jobs } from "./schema/queue.js";
import {
  claimJobs,
  completeJob,
  enqueueJob,
  failJob,
  jobMetrics,
  reapExpiredLeases,
  requeueDeadLetter,
} from "./jobs.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

gate("durable Postgres job queue", () => {
  const db = getDb();
  const suffix = randomUUID();
  const org = `org_jobs_${suffix}`;

  beforeAll(async () => {
    await db.execute(sql`select 1`);
    await db.insert(organizations).values({ id: org, name: "Jobs", slug: `jobs-${suffix}` });
  });
  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeDb();
  });

  it("enqueues idempotently per (job type, key)", async () => {
    const first = await enqueueJob(db, {
      type: "email.send",
      payload: { n: 1 },
      accountId: org,
      idempotencyKey: `k-${suffix}`,
    });
    const again = await enqueueJob(db, {
      type: "email.send",
      payload: { n: 1 },
      accountId: org,
      idempotencyKey: `k-${suffix}`,
    });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.id).toBe(first.id);
    // The same key may be reused by a different job type.
    const other = await enqueueJob(db, {
      type: "webhook.deliver",
      payload: {},
      accountId: org,
      idempotencyKey: `k-${suffix}`,
    });
    expect(other.created).toBe(true);
  });

  it("does not claim work whose delay has not elapsed", async () => {
    const delayed = await enqueueJob(db, {
      type: "email.send",
      payload: { scheduled: true },
      accountId: org,
      delayMs: 60_000,
      idempotencyKey: `delay-${suffix}`,
    });
    const claimed = await claimJobs(db, { workerId: "w-delay", limit: 100 });
    expect(claimed.some((j) => j.id === delayed.id)).toBe(false);
    await db
      .update(jobs)
      .set({ availableAt: new Date(0) })
      .where(eq(jobs.id, delayed.id));
  });

  it("claims a batch once under concurrency (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) {
      await enqueueJob(db, {
        type: "email.send",
        payload: { i },
        accountId: org,
        idempotencyKey: `batch-${suffix}-${i}`,
      });
    }
    const [a, b] = await Promise.all([
      claimJobs(db, { workerId: "w-a", limit: 10 }),
      claimJobs(db, { workerId: "w-b", limit: 10 }),
    ]);
    const ids = new Set([...a, ...b].map((j) => j.id));
    expect(ids.size).toBe(a.length + b.length);
    expect(a.length + b.length).toBe(20);
    expect([...a, ...b].every((j) => j.status === "processing" && j.attempts === 1)).toBe(true);
  });

  it("completes only for the lease owner and records metrics", async () => {
    const [job] = await claimJobs(db, { workerId: "w-owner", limit: 1 });
    expect(job).toBeDefined();
    expect(await completeJob(db, { id: job!.id, workerId: "someone-else" })).toBe(false);
    expect(await completeJob(db, { id: job!.id, workerId: "w-owner" })).toBe(true);
    const metrics = await jobMetrics(db);
    expect(metrics.completed).toBeGreaterThanOrEqual(1);
  });

  it("retries with backoff, dead-letters when attempts are exhausted, and can be requeued", async () => {
    const job = await enqueueJob(db, {
      type: "webhook.deliver",
      payload: {},
      accountId: org,
      maxAttempts: 2,
      idempotencyKey: `retry-${suffix}`,
    });
    const [claimed] = await claimJobs(db, { workerId: "w-retry", types: ["webhook.deliver"] });
    expect(claimed?.id).toBe(job.id);
    const retry = await failJob(db, {
      id: job.id,
      error: "transient",
      retryable: true,
      retryDelayMs: 1_000,
    });
    expect(retry.status).toBe("pending");
    expect(retry.availableAt!.getTime()).toBeGreaterThan(Date.now());

    await db
      .update(jobs)
      .set({ availableAt: new Date(0) })
      .where(eq(jobs.id, job.id));
    await claimJobs(db, { workerId: "w-retry", types: ["webhook.deliver"] });
    const exhausted = await failJob(db, {
      id: job.id,
      error: "still failing",
      retryable: true,
    });
    expect(exhausted.status).toBe("dead_letter");

    expect(await requeueDeadLetter(db, job.id)).toBe(true);
    const [requeued] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(requeued!.status).toBe("pending");
    expect(requeued!.attempts).toBe(0);
  });

  it("recovers a crashed processor by reaping an expired lease", async () => {
    const job = await enqueueJob(db, {
      type: "email.send",
      payload: {},
      accountId: org,
      idempotencyKey: `crash-${suffix}`,
    });
    const claimed = await claimJobs(db, { workerId: "w-crash", limit: 50 });
    expect(claimed.some((c) => c.id === job.id)).toBe(true);
    await db
      .update(jobs)
      .set({ lockedUntil: new Date(Date.now() - 60_000) })
      .where(eq(jobs.id, job.id));
    const reaped = await reapExpiredLeases(db);
    expect(reaped).toBeGreaterThanOrEqual(1);
    const [recovered] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(recovered!.status).toBe("pending");
    expect(recovered!.lockedBy).toBeNull();
    const [reclaimed] = await claimJobs(db, { workerId: "w-recover", limit: 5 });
    expect(reclaimed?.id).toBe(job.id);
    expect(reclaimed!.attempts).toBe(2);
  });
});
