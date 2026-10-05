import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.RUN_INTEGRATION_TESTS ??= "";
const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

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

gate("organization suspension kill-switch (live Postgres)", async () => {
  const { randomBytes } = await import("node:crypto");
  const {
    getDb,
    users,
    organizations,
    organizationMembers,
    projects,
    apiKeys,
    emails,
    emailEvents,
    auditLogs,
    insertApiKeyForActiveOrganization,
    setOrganizationSendingStatus,
    cleanupSuiteOrg,
  } = await import("@calder/db");
  const { generateApiKey } = await import("@calder/auth");
  const { eq, and, inArray, count } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_kill_${suffix}`;
  const userId = `usr_kill_${suffix}`;
  const projectIds = [`proj_kill_a_${suffix}`, `proj_kill_b_${suffix}`];
  const app = createApp();
  const keys = projectIds.map(() => generateApiKey("live"));
  const savedDayOneConfig = {
    ORG_NEW_SEND_LIMIT: process.env.ORG_NEW_SEND_LIMIT,
    ORG_NEW_SEND_WINDOW_HOURS: process.env.ORG_NEW_SEND_WINDOW_HOURS,
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  };
  const adminSecret = `admin-safety-${suffix}-${"k".repeat(16)}`;

  beforeAll(async () => {
    if (!(await reachable())) return;
    process.env.ORG_NEW_SEND_LIMIT = "1";
    process.env.ORG_NEW_SEND_WINDOW_HOURS = "24";
    process.env.ADMIN_API_KEY = adminSecret;
    const { resetConfig } = await import("@calder/config");
    resetConfig();
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `kill-${suffix}@test.test` });
    await db.insert(organizations).values({
      id: orgId,
      name: "Kill Switch Test",
      slug: `kill-${suffix}`,
    });
    await db.insert(organizationMembers).values({
      id: `orgm_kill_${suffix}`,
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await db.insert(projects).values([
      { id: projectIds[0]!, organizationId: orgId, name: "A", slug: "a" },
      { id: projectIds[1]!, organizationId: orgId, name: "B", slug: "b" },
    ]);
    await db.insert(apiKeys).values(
      projectIds.map((projectId, index) => ({
        id: `key_kill_${suffix}_${index}`,
        projectId,
        name: `live ${index}`,
        keyPrefix: keys[index]!.prefix,
        keyHash: keys[index]!.hash,
        env: "live" as const,
      }))
    );
  });

  afterAll(async () => {
    if (await reachable()) await cleanupSuiteOrg(getDb(), orgId, userId);
    for (const [key, value] of Object.entries(savedDayOneConfig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const { resetConfig } = await import("@calder/config");
    resetConfig();
  });

  it("serializes concurrent API sends across project keys at the new-organization cap", async () => {
    if (!(await reachable())) return;
    const recipients = Array.from(
      { length: 3 },
      (_, index) => `cap-recipient-${suffix}-${index}@example.test`
    );
    const send = (index: number) =>
      app.request("/v1/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${keys[index % projectIds.length]!.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: `cap-${suffix}@test.test`,
          to: recipients[index],
          subject: "cap test",
          text: "test",
        }),
      });
    const responses = await Promise.all([0, 1, 2].map(send));
    expect(responses.filter((response) => response.status === 202)).toHaveLength(1);
    const blocked = responses.filter((response) => response.status === 403);
    expect(blocked).toHaveLength(2);
    for (const response of blocked) {
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("organization_sending_unavailable");
      expect(body.error.message).not.toMatch(/50|24|limit|threshold/i);
    }

    const db = getDb();
    const acceptedRows = await db
      .select({ id: emails.id, projectId: emails.projectId })
      .from(emails)
      .where(inArray(emails.to, recipients));
    expect(acceptedRows).toHaveLength(1);
    const [queuedEventCount] = await db
      .select({ value: count() })
      .from(emailEvents)
      .where(and(eq(emailEvents.emailId, acceptedRows[0]!.id), eq(emailEvents.type, "queued")));
    expect(Number(queuedEventCount?.value)).toBe(1);
    // This test checks admission, not delivery; make the row terminal so the
    // shared integration-suite cleanup never waits on this queued message.
    await db
      .update(emails)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(emails.id, acceptedRows[0]!.id));
  });

  it("revokes every project key immediately, blocks key creation, and never revives old keys", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    const request = (secret: string) =>
      app.request("/v1/emails", { headers: { authorization: `Bearer ${secret}` } });

    const before = await request(keys[0]!.secret);
    expect(before.status).toBe(200);

    const suspension = await app.request(`/v1/admin/organizations/${orgId}/sending-status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
        "idempotency-key": `suspend-${suffix}`,
      },
      body: JSON.stringify({ status: "suspended", reason: "Abuse safety integration test" }),
    });
    expect(suspension.status).toBe(200);
    const suspensionBody = (await suspension.json()) as {
      data: { status: string; revokedKeyCount: number };
    };
    expect(suspensionBody.data.status).toBe("suspended");
    expect(suspensionBody.data.revokedKeyCount).toBe(2);

    const replay = await app.request(`/v1/admin/organizations/${orgId}/sending-status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
        "idempotency-key": `suspend-${suffix}`,
      },
      body: JSON.stringify({ status: "suspended", reason: "Abuse safety integration test" }),
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      data: { status: string; revokedKeyCount: number };
    };
    expect(replayBody.data).toEqual(suspensionBody.data);

    const keyConflict = await app.request(`/v1/admin/organizations/${orgId}/sending-status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminSecret}`,
        "content-type": "application/json",
        "idempotency-key": `suspend-${suffix}`,
      },
      body: JSON.stringify({ status: "active", reason: "Conflicting safety replay" }),
    });
    expect(keyConflict.status).toBe(409);

    const after = await request(keys[0]!.secret);
    expect(after.status).toBe(401);
    const revoked = await db
      .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, projectIds[0]!), eq(apiKeys.env, "live")));
    expect(revoked[0]?.revokedAt).toBeInstanceOf(Date);
    const allRevoked = await db
      .select({ value: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.projectId, projectIds[1]!), eq(apiKeys.env, "live")));
    expect(Number(allRevoked[0]?.value)).toBe(1);

    await expect(
      insertApiKeyForActiveOrganization(db, projectIds[0]!, {
        id: `key_blocked_${suffix}`,
        projectId: projectIds[0]!,
        name: "blocked key",
        keyPrefix: "calder_sk_test_blocked",
        keyHash: `blocked-hash-${suffix}`,
        env: "test",
      })
    ).rejects.toThrow("Sending is currently unavailable for this organization.");

    await setOrganizationSendingStatus(db, {
      organizationId: orgId,
      status: "active",
      actorUserId: userId,
      reason: "Manual review completed",
      idempotencyKey: `resume-${suffix}`,
    });
    const stillRevoked = await request(keys[0]!.secret);
    expect(stillRevoked.status).toBe(401);

    const [auditCount] = await db
      .select({ value: count() })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, orgId),
          eq(auditLogs.action, "organization.sending.suspended")
        )
      );
    expect(Number(auditCount?.value)).toBe(1);
  });
});
