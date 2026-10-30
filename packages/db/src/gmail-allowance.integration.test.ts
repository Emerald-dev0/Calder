import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "./client.js";
import { organizations } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { projectTransports } from "./schema/transports.js";
import { gmailSendAttempts } from "./schema/gmail-allowance.js";
import { gmailAllowanceForTransport, reserveGmailAttempt } from "./gmail-allowance.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;
gate("Gmail account allowance (Postgres)", () => {
  const id = randomUUID();
  const org = `org_${id}`,
    p1 = `p1_${id}`,
    p2 = `p2_${id}`;
  const t1 = `t1_${id}`,
    t2 = `t2_${id}`;
  const address = `${id}@gmail.com`;
  const hash = createHash("sha256").update(address).digest("hex");
  const db = getDb();
  beforeAll(async () => {
    await db.insert(organizations).values({ id: org, name: "Quota test", slug: id });
    await db.insert(projects).values([
      { id: p1, organizationId: org, name: "One", slug: "one" },
      { id: p2, organizationId: org, name: "Two", slug: "two" },
    ]);
    await db.insert(projectTransports).values([
      { id: t1, projectId: p1, type: "gmail", label: address },
      { id: t2, projectId: p2, type: "gmail", label: address.toUpperCase() },
    ]);
  });
  afterAll(async () => {
    await db.delete(gmailSendAttempts).where(eq(gmailSendAttempts.accountHash, hash));
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeDb();
  });
  it("serializes concurrent attempts across projects and keeps usage through reconnect", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) =>
        reserveGmailAttempt(db, i % 2 ? p1 : p2, i % 2 ? t1 : t2)
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
    const snapshot = await gmailAllowanceForTransport(db, p2, t2);
    expect(snapshot).toMatchObject({ used: 20, remaining: 0, limit: 20 });
    await db.delete(projectTransports).where(eq(projectTransports.id, t1));
    await db
      .insert(projectTransports)
      .values({ id: t1, projectId: p1, type: "gmail", label: address });
    await expect(reserveGmailAttempt(db, p1, t1)).rejects.toMatchObject({ code: "gmail_cap" });
  }, 30000);
  it("switches to a UTC daily allowance after 24 hours", async () => {
    await db.delete(gmailSendAttempts).where(eq(gmailSendAttempts.accountHash, hash));
    await db.insert(gmailSendAttempts).values({
      id: randomUUID(),
      accountHash: hash,
      attemptedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    const allowance = await gmailAllowanceForTransport(db, p1, t1);
    expect(allowance).toMatchObject({ limit: 100, used: 0, remaining: 100 });
    await reserveGmailAttempt(db, p1, t1);
    expect(await gmailAllowanceForTransport(db, p1, t1)).toMatchObject({ used: 1, remaining: 99 });
  });
  it("enforces 100 attempts per UTC day under concurrency after warmup", async () => {
    await db.delete(gmailSendAttempts).where(eq(gmailSendAttempts.accountHash, hash));
    await db.insert(gmailSendAttempts).values({
      id: randomUUID(),
      accountHash: hash,
      attemptedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });
    const results = await Promise.allSettled(
      Array.from({ length: 110 }, (_, i) =>
        reserveGmailAttempt(db, i % 2 ? p1 : p2, i % 2 ? t1 : t2)
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(100);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10);
    expect(await gmailAllowanceForTransport(db, p1, t1)).toMatchObject({
      limit: 100,
      used: 100,
      remaining: 0,
    });
  }, 30000);
});
