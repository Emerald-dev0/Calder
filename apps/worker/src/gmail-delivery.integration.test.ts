import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { resetConfig } from "@calder/config";
import { encryptSecret } from "@calder/auth";
import {
  getDb,
  organizations,
  projects,
  projectTransports,
  emails,
  gmailSendAttempts,
  gmailAllowanceForTransport,
} from "@calder/db";
import { processEmailJob } from "./worker.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;
gate("worker Gmail delivery (Postgres, simulated Google)", () => {
  const id = randomUUID(),
    org = `org_${id}`,
    project = `proj_${id}`,
    transport = `tr_${id}`;
  const address = `${id}@gmail.com`;
  const hash = createHash("sha256").update(address).digest("hex");
  const db = getDb();
  let sends = 0;
  let failRefresh = true;
  beforeAll(async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-secret");
    resetConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://oauth2.googleapis.com/token")
          return failRefresh
            ? new Response("{}", { status: 503 })
            : Response.json({ access_token: "fixture-access", expires_in: 3600 });
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
          sends++;
          const raw = (JSON.parse(String(init?.body)) as { raw: string }).raw;
          expect(Buffer.from(raw, "base64url").toString()).toMatch(/calder/i);
          return sends === 1
            ? new Response("{}", { status: 503 })
            : Response.json({ id: "gmail-message" });
        }
        throw new Error(`Unexpected request ${url}`);
      })
    );
    await db.insert(organizations).values({ id: org, name: "Gmail worker test", slug: id });
    await db
      .insert(projects)
      .values({ id: project, organizationId: org, name: "Test", slug: "test" });
    const [iv, ciphertext, tag] = encryptSecret(
      JSON.stringify({ refreshToken: "fixture" }),
      "gmail"
    ).split(":");
    await db.insert(projectTransports).values({
      id: transport,
      projectId: project,
      type: "gmail",
      label: address,
      isDefault: true,
      dailyCap: 2,
      encryptedCredentials: { iv: iv!, ciphertext: ciphertext!, tag: tag! },
    });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfig();
    await db.delete(gmailSendAttempts).where(eq(gmailSendAttempts.accountHash, hash));
    await db.delete(organizations).where(eq(organizations.id, org));
  });
  it("does not start the clock on token failure; counts retries that reach Gmail and enforces cap", async () => {
    const emailId = `email_${id}`;
    await db.insert(emails).values({
      id: emailId,
      projectId: project,
      from: address,
      to: "recipient@example.test",
      subject: "Hello",
      text: "Body",
      status: "queued",
      env: "live",
      // Other suites run the global drain against this same database. The
      // direct worker job is intentional; keep those drains off our rows.
      scheduledFor: new Date(Date.now() + 86400000),
    });
    const job = (attempts: number) => ({
      id: `job_${id}`,
      name: "email:deliver",
      data: { emailId, projectId: project },
      attempts,
      maxAttempts: 5,
      createdAt: new Date(),
    });
    await expect(processEmailJob(job(0))).rejects.toBeDefined();
    expect(await gmailAllowanceForTransport(db, project, transport)).toMatchObject({
      firstSendAt: null,
      used: 0,
    });
    failRefresh = false;
    await expect(processEmailJob(job(1))).rejects.toBeDefined();
    expect(await gmailAllowanceForTransport(db, project, transport)).toMatchObject({
      used: 1,
      remaining: 1,
    });
    expect(await processEmailJob(job(2))).toBe("sent");
    expect(sends).toBe(2);
    expect(await gmailAllowanceForTransport(db, project, transport)).toMatchObject({
      used: 2,
      remaining: 0,
    });
    const next = `next_${id}`;
    await db.insert(emails).values({
      id: next,
      projectId: project,
      from: address,
      to: "recipient@example.test",
      subject: "Blocked",
      text: "Body",
      status: "queued",
      env: "live",
      // Other suites run the global drain against this same database. The
      // direct worker job is intentional; keep those drains off our rows.
      scheduledFor: new Date(Date.now() + 86400000),
    });
    expect(await processEmailJob({ ...job(0), data: { emailId: next, projectId: project } })).toBe(
      "failed"
    );
    expect(sends).toBe(2);
  });
});
