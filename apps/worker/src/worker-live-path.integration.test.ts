import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
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
 * The WORKER delivery path, live, without AWS credentials.
 *
 * In production with Redis configured, sends are delivered by the BullMQ
 * worker (apps/worker), not by the serverless drain — the worker has its own
 * transport chain, its own retry model (rethrow → queue backoff) and its own
 * ledger writes. Only a missing-record test covered it before, so a live
 * customer on the Redis path had no delivery proof at all.
 *
 * processEmailJob() is driven directly (no Redis needed) against a local
 * SES-protocol endpoint, so the real provider, the real payload and the real
 * status/ledger/webhook side effects are all exercised for the live env.
 */
gate("worker live delivery path against a real SES-protocol endpoint", async () => {
  const { randomBytes } = await import("node:crypto");
  const { getDb, organizations, organizationMembers, projects, users, emails, usageRecords } =
    await import("@calder/db");
  const { eq, count } = await import("drizzle-orm");
  const { processEmailJob } = await import("./worker.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_wk_${suffix}`;
  const projId = `proj_wk_${suffix}`;
  const userId = `usr_wk_${suffix}`;
  const from = `worker-${suffix}@test.test`;

  const captured: { path: string; body: Record<string, unknown> }[] = [];
  let mode: "ok" | "throttle" | "reject" = "ok";
  let sequence = 0;
  let server: Server;

  const savedEnv = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL,
    REDIS_URL: process.env.REDIS_URL,
  };

  /** Build a queue job exactly as the queue would hand it to the worker. */
  const job = (emailId: string, attempts = 0, maxAttempts = 5) => ({
    id: `job_${randomBytes(6).toString("hex")}`,
    name: "email:deliver",
    data: { emailId, projectId: projId },
    attempts,
    maxAttempts,
    createdAt: new Date(),
  });

  async function seedQueued(over: { env?: string; to?: string } = {}) {
    const id = `em_wk_${randomBytes(6).toString("hex")}`;
    await getDb()
      .insert(emails)
      .values({
        id,
        projectId: projId,
        from,
        to: over.to ?? `to-${suffix}@example.test`,
        subject: "worker live",
        text: "worker live body",
        status: "queued",
        attemptCount: 0,
        env: over.env ?? "live",
      });
    return id;
  }

  beforeAll(async () => {
    if (!(await reachable())) return;
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          body = {};
        }
        captured.push({ path: req.url ?? "", body });
        if (req.url !== "/v2/email/outbound-emails") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "unhandled" }));
          return;
        }
        if (mode === "throttle") {
          res.writeHead(429, {
            "content-type": "application/json",
            "x-amzn-errortype": "TooManyRequestsException",
          });
          res.end(JSON.stringify({ message: "Maximum sending rate exceeded." }));
          return;
        }
        if (mode === "reject") {
          res.writeHead(400, {
            "content-type": "application/json",
            "x-amzn-errortype": "MessageRejected",
          });
          res.end(JSON.stringify({ message: "Email address is not verified." }));
          return;
        }
        sequence += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ MessageId: `0100-worker-${sequence}-${suffix}` }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;

    process.env.AWS_ACCESS_KEY_ID = "AKIAWORKERTEST";
    process.env.AWS_SECRET_ACCESS_KEY = "worker-test-secret";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = `http://127.0.0.1:${port}`;
    // No Redis: the worker must not require a queue to deliver a job.
    delete process.env.REDIS_URL;

    const db = getDb();
    await db.insert(users).values({ id: userId, email: `wk-${suffix}@test.test` });
    await db.insert(organizations).values({ id: orgId, name: "Worker", slug: `wk-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((r) => server?.close(() => r()));
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("delivers a live job through the real provider and records provider truth", async () => {
    const emailId = await seedQueued();
    const outcome = await processEmailJob(job(emailId));
    expect(outcome).toBe("sent");

    const [row] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.status).toBe("sent");
    expect(row?.provider).toBe("ses");
    expect(row?.transport).toBe("default");
    expect(row?.providerMessageId).toMatch(new RegExp(`^0100-worker-\\d+-${suffix}$`));

    // The wire payload is a real SES SendEmail request for this message.
    const sent = captured.filter((c) => c.path === "/v2/email/outbound-emails");
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const payload = sent[sent.length - 1]!.body as {
      FromEmailAddress: string;
      Destination: { ToAddresses: string[] };
      Content: { Simple: { Subject: { Data: string }; Body: { Text?: { Data: string } } } };
    };
    expect(payload.FromEmailAddress).toBe(from);
    expect(payload.Destination.ToAddresses).toEqual([`to-${suffix}@example.test`]);
    expect(payload.Content.Simple.Subject.Data).toBe("worker live");
    expect(payload.Content.Simple.Body.Text?.Data).toBe("worker live body");

    // Metered exactly once, like the serverless drain.
    const ledger = await getDb()
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${emailId}`));
    expect(Number(ledger[0]?.value ?? 0)).toBe(1);
  });

  it("treats a throttled live send as retryable: throws for the queue, never fails the mail", async () => {
    mode = "throttle";
    const emailId = await seedQueued({ to: `throttled-${suffix}@example.test` });

    // The queue contract: a transient failure is thrown so BullMQ re-enqueues
    // with backoff. Marking the row failed here would drop the customer's mail.
    await expect(processEmailJob(job(emailId, 0, 5))).rejects.toThrow();

    const [row] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.status).not.toBe("failed");

    // Recovery on the next attempt, same job, without a re-send by the caller.
    mode = "ok";
    const outcome = await processEmailJob(job(emailId, 1, 5));
    expect(outcome).toBe("sent");
    const [delivered] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(delivered?.status).toBe("sent");
    expect(delivered?.provider).toBe("ses");
  });

  it("fails a hard provider rejection permanently with the reason recorded", async () => {
    mode = "reject";
    const emailId = await seedQueued({ to: `rejected-${suffix}@example.test` });
    const outcome = await processEmailJob(job(emailId, 0, 5));
    expect(outcome).toBe("failed");
    mode = "ok";

    const [row] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.status).toBe("failed");
    expect(String(row?.lastError ?? "")).toMatch(/not verified|rejected/i);
  });

  it("keeps test-env rows on the mock provider even with live credentials present", async () => {
    const emailId = await seedQueued({ env: "test", to: `sandbox-${suffix}@example.test` });
    const before = captured.length;
    const outcome = await processEmailJob(job(emailId));
    expect(outcome).toBe("sent");

    const [row] = await getDb().select().from(emails).where(eq(emails.id, emailId)).limit(1);
    expect(row?.provider).toBe("mock");
    expect(row?.transport).toBe("mock");
    // Nothing new hit the wire, and no ledger row was written for test traffic.
    expect(captured.length).toBe(before);
    const ledger = await getDb()
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${emailId}`));
    expect(Number(ledger[0]?.value ?? 0)).toBe(0);
  });
});
