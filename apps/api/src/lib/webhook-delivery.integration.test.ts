import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";

process.env.AUTH_SECRET ??= "test-auth-secret-with-at-least-32-characters!!";

const http = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers: Record<string, string>; body: string }>,
  handler: async (_url: string, _headers: Record<string, string>, _body: string) => ({
    kind: "response" as const,
    status: 200,
    latencyMs: 3,
  }),
}));

vi.mock("./webhook-http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./webhook-http.js")>();
  return {
    ...actual,
    postWebhook: async (url: string, headers: Record<string, string>, body: string) => {
      http.calls.push({ url, headers, body });
      return http.handler(url, headers, body);
    },
  };
});

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

/**
 * Round 5, workstream 3: webhook lifecycle acceptance scenarios against real
 * PostgreSQL. The outbound HTTP client is replaced (no public endpoint can be
 * reached from the sandbox), so these prove persistence, leasing, state
 * transitions, signing and policy — NOT deployed network behaviour.
 */
gate("webhook lifecycle on the Postgres queue (live Postgres)", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const orgId = `org_wh5_${suffix}`;
  const projectA = `proj_wh5a_${suffix}`;
  const projectB = `proj_wh5b_${suffix}`;
  const userId = `usr_wh5_${suffix}`;
  const workerPrefix = `wh5_${suffix}`;
  const rawSecret = `whsec_${suffix}_do_not_log`;

  let db: Awaited<ReturnType<typeof import("@calder/db").getDb>>;
  let mod: typeof import("@calder/db");
  let delivery: typeof import("./webhook-delivery.js");
  let deliver: typeof import("./webhook-delivery.js").deliverWebhookJob;

  async function seedHook(projectId: string, enabled = true): Promise<string> {
    const { encryptSecret } = await import("@calder/auth");
    const id = `wh_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await db.insert(mod.webhooks).values({
      id,
      projectId,
      url: `https://endpoint-${suffix}.example.test/hook`,
      secret: encryptSecret(rawSecret, mod.WEBHOOK_SECRET_CONTEXT),
      events: ["email.delivered"],
      enabled,
    });
    return id;
  }

  async function seedDelivery(opts: { projectId?: string; webhookId?: string } = {}) {
    const id = `whd_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
    const project = opts.projectId ?? projectA;
    const webhookId = opts.webhookId ?? (await seedHook(project));
    await db.insert(mod.webhookDeliveries).values({
      id,
      webhookId,
      projectId: project,
      event: "email.delivered",
      payload: {
        id,
        event: "email.delivered",
        createdAt: new Date().toISOString(),
        data: { emailId: "em_x" },
      },
      status: "pending",
      attemptCount: 0,
    });
    const job = await mod.enqueueJob(db, {
      type: "webhook.deliver",
      accountId: orgId,
      payload: { deliveryId: id, projectId: project },
      idempotencyKey: `wh5-job-${id}`,
      priority: 100,
      maxAttempts: mod.WEBHOOK_MAX_ATTEMPTS,
    });
    return { deliveryId: id, jobId: job.id, webhookId };
  }

  async function claimDeliveryJob(worker: string, expectedDeliveryId?: string) {
    // Earlier cases can leave a pending wake-up for a different delivery. The
    // queue has no payload filter, so claim one at a time and hand foreign
    // work straight back (not an attempt) until the expected delivery arrives.
    for (let i = 0; i < 50; i++) {
      const [job] = await mod.claimJobs(db, {
        workerId: worker,
        limit: 1,
        types: ["webhook.deliver"],
        leaseSeconds: 120,
      });
      expect(job).toBeDefined();
      if (!expectedDeliveryId || job!.payload?.deliveryId === expectedDeliveryId) return job!;
      await mod.releaseClaim(db, { id: job!.id, workerId: worker });
    }
    throw new Error("expected delivery job was not claimable");
  }

  async function attemptRows(deliveryId: string) {
    return db
      .select()
      .from(mod.webhookDeliveryAttempts)
      .where(eq(mod.webhookDeliveryAttempts.deliveryId, deliveryId))
      .orderBy(mod.webhookDeliveryAttempts.attempt);
  }

  beforeAll(async () => {
    db = (await import("@calder/db")).getDb();
    mod = await import("@calder/db");
    delivery = await import("./webhook-delivery.js");
    deliver = delivery.deliverWebhookJob;
    await db.insert(mod.users).values({ id: userId, email: `wh5-${suffix}@test.test` });
    await db.insert(mod.organizations).values({ id: orgId, name: "WH5", slug: `wh5-${suffix}` });
    await db.insert(mod.organizationMembers).values({
      id: `orgm_wh5_${suffix}`,
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(mod.projects).values([
      { id: projectA, organizationId: orgId, name: "A", slug: `a-${suffix}` },
      { id: projectB, organizationId: orgId, name: "B", slug: `b-${suffix}` },
    ]);
  });

  afterAll(async () => {
    await mod.cleanupSuiteOrg(db, orgId, userId);
    await mod.closeDb();
  });

  it("persists a durable event and a delivery job in the new queue", async () => {
    http.calls.length = 0;
    await seedHook(projectA);
    const beforeJobs = await db
      .select({ id: mod.jobs.id })
      .from(mod.jobs)
      .where(eq(mod.jobs.jobType, "webhook.deliver"));
    const count = await mod.enqueueWebhookDeliveries(db, {
      projectId: projectA,
      event: "email.delivered",
      data: { emailId: "em_durable" },
    });
    expect(count).toBe(1);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.projectId, projectA))
      .orderBy(sql`${mod.webhookDeliveries.createdAt} desc`)
      .limit(1);
    expect(row?.payload).toMatchObject({ id: row?.id, type: "email.delivered" });
    const jobs = await db
      .select()
      .from(mod.jobs)
      .where(sql`${mod.jobs.payload}->>'deliveryId' = ${row!.id}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("pending");
    expect(beforeJobs.length + 1).toBeGreaterThanOrEqual(jobs.length);
    // Leave no low-priority wake-up that later cases could claim first.
    await db
      .update(mod.jobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(mod.jobs.id, jobs[0]!.id));
  });

  it("delivers on 2xx, records the attempt, and leaves the envelope stable", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 5 });
    const { deliveryId } = await seedDelivery();
    const job = await claimDeliveryJob(`${workerPrefix}_ok`, deliveryId);
    const result = await deliver(db, { job, workerId: `${workerPrefix}_ok` });
    expect(result.status).toBe("delivered");

    const rows = await attemptRows(deliveryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("delivered");
    expect(rows[0]?.responseStatus).toBe(200);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("delivered");
    expect(row?.attemptCount).toBe(1);
    expect(row?.deliveredAt).not.toBeNull();
    expect(await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_ok` })).toBe(true);
  });

  it("signs the exact stored body with HMAC and never stores the secret", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 2 });
    const { deliveryId } = await seedDelivery();
    const job = await claimDeliveryJob(`${workerPrefix}_sign`, deliveryId);
    await deliver(db, { job, workerId: `${workerPrefix}_sign` });
    const call = http.calls.at(-1)!;
    expect(call.headers["webhook-id"]).toBe(deliveryId);
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(call.headers["webhook-signature"]!);
    expect(match).not.toBeNull();
    const timestamp = Number(match![1]);
    expect(Math.abs(Math.floor(Date.now() / 1000) - timestamp)).toBeLessThan(30);
    const expected = createHmac("sha256", rawSecret)
      .update(`${timestamp}.${call.body}`)
      .digest("hex");
    expect(match![2]).toBe(expected);
    expect(call.body).not.toContain(rawSecret);
    expect(call.headers["webhook-signature"]).not.toContain(rawSecret);

    const rows = await attemptRows(deliveryId);
    expect(JSON.stringify(rows)).not.toContain(rawSecret);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(JSON.stringify(row)).not.toContain(rawSecret);
    await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_sign` });
  });

  it("retries a retryable response with backoff and a byte-identical payload", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 503, latencyMs: 4 });
    const { deliveryId } = await seedDelivery();
    const firstJob = await claimDeliveryJob(`${workerPrefix}_retry1`, deliveryId);
    const first = await deliver(db, { job: firstJob, workerId: `${workerPrefix}_retry1` });
    expect(first.status).toBe("retryable");
    expect(first.retryDelayMs).toBeGreaterThanOrEqual(1_000);
    const afterFirst = await mod.failJob(db, {
      id: firstJob.id,
      workerId: `${workerPrefix}_retry1`,
      error: "retry",
      retryable: true,
      retryDelayMs: first.retryDelayMs!,
    });
    expect(afterFirst.status).toBe("pending");

    const [pending] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(pending?.status).toBe("pending");
    expect(pending?.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 1_000);

    const firstBody = http.calls[0]!.body;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 4 });
    await db
      .update(mod.jobs)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.jobs.id, firstJob.id));
    await db
      .update(mod.webhookDeliveries)
      .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    const secondJob = await claimDeliveryJob(`${workerPrefix}_retry2`, deliveryId);
    const second = await deliver(db, { job: secondJob, workerId: `${workerPrefix}_retry2` });
    expect(second.status).toBe("delivered");
    expect(http.calls[1]!.body).toBe(firstBody);
    expect(http.calls[1]!.headers["webhook-id"]).toBe(http.calls[0]!.headers["webhook-id"]);

    const rows = await attemptRows(deliveryId);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);
    expect(rows[0]?.outcome).toBe("retryable");
    expect(rows[1]?.outcome).toBe("delivered");
    await mod.completeJob(db, { id: secondJob.id, workerId: `${workerPrefix}_retry2` });
  });

  it("treats 4xx configuration errors as permanent and does not retry them", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 404, latencyMs: 2 });
    const { deliveryId } = await seedDelivery();
    const job = await claimDeliveryJob(`${workerPrefix}_perm`, deliveryId);
    const result = await deliver(db, { job, workerId: `${workerPrefix}_perm` });
    expect(result.status).toBe("permanent");
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("failed");
    expect(row?.nextAttemptAt).toBeNull();
    expect(row?.lockedBy).toBeNull();
    const rows = await attemptRows(deliveryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("permanent");
    expect(await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_perm` })).toBe(true);
  });

  it("enforces the attempt cap with the documented 8-attempt budget", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 500, latencyMs: 1 });
    const { deliveryId, jobId } = await seedDelivery();
    const statuses: string[] = [];
    for (let i = 0; i < mod.WEBHOOK_MAX_ATTEMPTS; i++) {
      await db
        .update(mod.jobs)
        .set({ availableAt: new Date(Date.now() - 1_000) })
        .where(eq(mod.jobs.id, jobId));
      await db
        .update(mod.webhookDeliveries)
        .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
        .where(eq(mod.webhookDeliveries.id, deliveryId));
      const job = await claimDeliveryJob(`${workerPrefix}_cap${i}`, deliveryId);
      expect(job.id).toBe(jobId);
      const result = await deliver(db, { job, workerId: `${workerPrefix}_cap${i}` });
      statuses.push(result.status);
      if (result.status === "retryable") {
        await mod.failJob(db, {
          id: jobId,
          workerId: `${workerPrefix}_cap${i}`,
          error: "retry",
          retryable: true,
          retryDelayMs: 1,
        });
      } else {
        await mod.completeJob(db, { id: jobId, workerId: `${workerPrefix}_cap${i}` });
      }
    }
    expect(statuses.slice(0, -1).every((s) => s === "retryable")).toBe(true);
    expect(statuses.at(-1)).toBe("exhausted");
    const rows = await attemptRows(deliveryId);
    expect(rows).toHaveLength(mod.WEBHOOK_MAX_ATTEMPTS);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("exhausted");
    expect(http.calls).toHaveLength(mod.WEBHOOK_MAX_ATTEMPTS);

    // No ninth attempt is possible: the job is terminal and the delivery is no
    // longer pending/due.
    const extra = await mod.claimJobs(db, {
      workerId: `${workerPrefix}_capx`,
      types: ["webhook.deliver"],
    });
    expect(extra.some((j) => j.id === jobId)).toBe(false);
  });

  it("uses a strictly increasing retry schedule", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => mod.nextRetryDelayMs(n)!);
    for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    expect(mod.nextRetryDelayMs(8)).toBeNull();
  });

  it("recovers a delivery whose attempt lease expired after a crash", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 2 });
    const { deliveryId } = await seedDelivery();
    const claimed = await mod.claimWebhookDelivery(db, {
      deliveryId,
      workerId: `${workerPrefix}_crash`,
      leaseSeconds: 10,
    });
    expect(claimed).not.toBeNull();
    await db
      .update(mod.webhookDeliveries)
      .set({ lockExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    const recovered = await mod.recoverExpiredWebhookDeliveries(db);
    expect(recovered).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("pending");
    expect(row?.lockedBy).toBeNull();
    const again = await mod.claimWebhookDelivery(db, {
      deliveryId,
      workerId: `${workerPrefix}_crash2`,
      leaseSeconds: 10,
    });
    expect(again?.id).toBe(deliveryId);
    await mod.finishWebhookAttempt(db, {
      deliveryId,
      projectId: projectA,
      workerId: `${workerPrefix}_crash2`,
      attempt: 1,
      outcome: "permanent",
      error: "test cleanup",
    });
  });

  it("rejects a stale result from a processor that lost its lease", async () => {
    const { deliveryId } = await seedDelivery();
    const claimed = await mod.claimWebhookDelivery(db, {
      deliveryId,
      workerId: `${workerPrefix}_owner`,
      leaseSeconds: 10,
    });
    expect(claimed?.id).toBe(deliveryId);
    const stale = await mod.finishWebhookAttempt(db, {
      deliveryId,
      projectId: projectA,
      workerId: `${workerPrefix}_not_owner`,
      attempt: 1,
      outcome: "delivered",
    });
    expect(stale).toBe(false);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("sending");
    expect(row?.lockedBy).toBe(`${workerPrefix}_owner`);
    await mod.finishWebhookAttempt(db, {
      deliveryId,
      projectId: projectA,
      workerId: `${workerPrefix}_owner`,
      attempt: 1,
      outcome: "permanent",
      error: "test cleanup",
    });
  });

  it("isolates tenants: a job cannot deliver another project's event", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 2 });
    const { deliveryId, jobId } = await seedDelivery();
    await db
      .update(mod.jobs)
      .set({ payload: { deliveryId, projectId: projectB } })
      .where(eq(mod.jobs.id, jobId));
    const job = await claimDeliveryJob(`${workerPrefix}_tenant`, deliveryId);
    expect(job.id).toBe(jobId);
    const result = await deliver(db, { job, workerId: `${workerPrefix}_tenant` });
    expect(result.status).toBe("permanent");
    expect(result.error).toBe("project_mismatch");
    expect(http.calls).toHaveLength(0);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("failed");
    expect(row?.projectId).toBe(projectA);
    await mod.completeJob(db, { id: jobId, workerId: `${workerPrefix}_tenant` });
  });

  it("treats a disabled endpoint as an explicit permanent policy decision", async () => {
    http.calls.length = 0;
    const webhookId = await seedHook(projectA, false);
    const { deliveryId } = await seedDelivery({ webhookId });
    const job = await claimDeliveryJob(`${workerPrefix}_disabled`, deliveryId);
    const result = await deliver(db, { job, workerId: `${workerPrefix}_disabled` });
    expect(result.status).toBe("permanent");
    expect(http.calls).toHaveLength(0);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("endpoint_disabled");
    await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_disabled` });
  });

  it("lists terminal failures for inspection and safely reprocesses one", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 410, latencyMs: 1 });
    const { deliveryId } = await seedDelivery({
      webhookId: await seedHook(projectA),
    });
    const job = await claimDeliveryJob(`${workerPrefix}_dead`, deliveryId);
    const result = await deliver(db, { job, workerId: `${workerPrefix}_dead` });
    expect(result.status).toBe("permanent");
    await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_dead` });

    const failed = await mod.listFailedWebhookDeliveries(db, 200);
    expect(failed.some((d) => d.id === deliveryId)).toBe(true);

    const replay = await mod.reprocessWebhookDelivery(db, deliveryId);
    expect(replay.requeued).toBe(true);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("pending");
    expect(row?.attemptCount).toBe(0);
    const jobs = await db
      .select()
      .from(mod.jobs)
      .where(sql`${mod.jobs.payload}->>'deliveryId' = ${deliveryId}`);
    expect(jobs.some((j) => j.status === "pending")).toBe(true);

    // A delivered event is not replayed by the retry path.
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 1 });
    // The reprocess wake-up is deliberately low priority in production; lift it
    // here so older leftover test jobs cannot shadow it in this shared DB.
    const replayId = jobs.find((j) => j.status === "pending")!.id;
    await db.update(mod.jobs).set({ priority: 1000 }).where(eq(mod.jobs.id, replayId));
    const replayJob = await claimDeliveryJob(`${workerPrefix}_replay`, deliveryId);
    await db
      .update(mod.jobs)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(mod.jobs.id, replayJob.id));
    const delivered = await deliver(db, { job: replayJob, workerId: `${workerPrefix}_replay` });
    expect(delivered.status).toBe("delivered");
    await mod.completeJob(db, { id: replayJob.id, workerId: `${workerPrefix}_replay` });
    const refused = await mod.reprocessWebhookDelivery(db, deliveryId);
    expect(refused.requeued).toBe(false);
    expect(refused.reason).toBe("already_delivered");
  });

  it("never duplicates the event id when a retry cycle is reprocessed", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 500, latencyMs: 1 });
    const { deliveryId } = await seedDelivery();
    const firstJob = await claimDeliveryJob(`${workerPrefix}_stable`, deliveryId);
    await deliver(db, { job: firstJob, workerId: `${workerPrefix}_stable` });
    await mod.completeJob(db, { id: firstJob.id, workerId: `${workerPrefix}_stable` });
    const replay = await mod.reprocessWebhookDelivery(db, deliveryId);
    expect(replay.requeued).toBe(true);
    const [row] = await db
      .select()
      .from(mod.webhookDeliveries)
      .where(eq(mod.webhookDeliveries.id, deliveryId));
    expect(row?.id).toBe(deliveryId);
    const attempts = await attemptRows(deliveryId);
    expect(attempts[0]?.deliveryId).toBe(deliveryId);
  });

  it("keeps attempt history scoped per delivery and per project", async () => {
    http.calls.length = 0;
    http.handler = async () => ({ kind: "response", status: 200, latencyMs: 1 });
    const one = await seedDelivery();
    const two = await seedDelivery();
    for (const [entry, index] of [
      [one, "a"],
      [two, "b"],
    ] as const) {
      const job = await claimDeliveryJob(`${workerPrefix}_scope${index}`, entry.deliveryId);
      await deliver(db, { job, workerId: `${workerPrefix}_scope${index}` });
      await mod.completeJob(db, { id: job.id, workerId: `${workerPrefix}_scope${index}` });
    }
    const all = await db
      .select()
      .from(mod.webhookDeliveryAttempts)
      .where(inArray(mod.webhookDeliveryAttempts.deliveryId, [one.deliveryId, two.deliveryId]));
    expect(all.filter((r) => r.deliveryId === one.deliveryId)).toHaveLength(1);
    expect(all.filter((r) => r.deliveryId === two.deliveryId)).toHaveLength(1);
    expect(all.every((r) => r.projectId === projectA)).toBe(true);
  });
});
