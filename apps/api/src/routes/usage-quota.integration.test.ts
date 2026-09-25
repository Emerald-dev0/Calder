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
 * Phase 2 acceptance (ADR-036):
 * - Quota blocks at the plan limit on the live path (402 plan_limit_reached),
 *   returns limit/usage/reset, and persists NOTHING for the refused send.
 * - Batch ingest applies the same gate per message.
 * - Test-key sends are never limited, never metered, stamp env='test', and
 *   drain exclusively through the mock provider — even in a deploy with
 *   live AWS credentials (no SES attempt possible for those rows).
 * - The usage ledger is exactly-once: deterministic ids make retries,
 *   replays and double-drains no-ops.
 * - Aggregation is idempotent: re-running the cron converges to the same
 *   summary, quantity stable.
 * - Period rollover: a stamped subscription cycle anchors the window; usage
 *   counting follows the cycle, not the calendar month blindly.
 * - Gmail daily cap accounting is exact: only sends that actually went via
 *   Gmail count (SES volume must never exhaust a Gmail quota).
 */
gate("usage, quota & env isolation (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const dbModule = await import("@calder/db");
  const {
    getDb,
    organizations,
    organizationMembers,
    projects,
    users,
    emails,
    usageRecords,
    usageSummaries,
    plans,
    subscriptions,
    projectTransports,
    recordSendUsage,
    aggregateUsageNow,
    orgUsagePeriod,
  } = dbModule;
  const { eq, and, count, inArray } = await import("drizzle-orm");
  const { sql } = await import("drizzle-orm");
  const { createApp } = await import("../app.js");
  const { registerDevKey } = await import("../middleware/auth.js");
  const { drainPendingEmails } = await import("../lib/drain.js");
  const { PLAN_LIMITS } = await import("@calder/config");

  const suffix = randomBytes(4).toString("hex");
  const rid = (p: string) => `${p}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // Org A sits AT the free-tier limit (5_000 live emails this period).
  // Org B starts clean. Org C carries a Gmail transport with a small cap.
  const orgA = `org_qa_${suffix}`;
  const orgB = `org_qb_${suffix}`;
  const orgC = `org_qc_${suffix}`;
  const projA = `proj_qa_${suffix}`;
  const projB = `proj_qb_${suffix}`;
  const projC = `proj_qc_${suffix}`;
  const userId = `usr_qty_${suffix}`;
  // Resolved in beforeAll: the catalog row for tier "free" either already
  // exists (a seeded, production-like database — `pnpm --filter @calder/db
  // db:seed`) or this suite creates it. Integration suites must not assume an
  // empty catalog, and must never delete a row they did not create.
  let planId = `plan_qty_${suffix}`;
  let planCreatedBySuite = false;
  const liveKeyA = `calder_live_qty_a_${suffix}`;
  const testKeyA = `calder_test_qty_a_${suffix}`;
  const liveKeyB = `calder_live_qty_b_${suffix}`;
  const liveKeyC = `calder_live_qty_c_${suffix}`;

  const app = createApp();
  const postEmails = (key: string, body: unknown) =>
    app.request("/v1/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });

  /** Poll until the drain (auto-kicked by the route, or our explicit call) finished with the row. */
  async function waitSettled(emailId: string, timeoutMs = 20_000) {
    const db = getDb();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await db.select().from(emails).where(eq(emails.id, emailId)).limit(1);
      if (row && (row.status === "sent" || row.status === "failed")) {
        return row;
      }
      if (Date.now() > deadline) return row;
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const FREE_LIMIT = PLAN_LIMITS.free.emailsPerMonth!;

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `qty-${suffix}@test.test` });
    const insertedPlan = await db
      .insert(plans)
      .values({ id: planId, tier: "free", name: "Qty Free" })
      .onConflictDoNothing({ target: plans.tier })
      .returning({ id: plans.id });
    if (insertedPlan.length > 0) {
      planCreatedBySuite = true;
    } else {
      const [existing] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.tier, "free"))
        .limit(1);
      planId = existing!.id;
    }
    for (const [orgId, projId, name] of [
      [orgA, projA, "At Limit"],
      [orgB, projB, "Clean"],
      [orgC, projC, "Gmail"],
    ] as const) {
      await db
        .insert(organizations)
        .values({ id: orgId, name, slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}` });
      await db
        .insert(organizationMembers)
        // One membership per org: the id must be unique per org. (It used to
        // end in a slice of the PROJECT id, which is identical for all three
        // orgs here — a guaranteed primary-key collision on a live database.)
        .values({ id: `orgm_${orgId}`, organizationId: orgId, userId, role: "owner" });
      await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
    }
    registerDevKey(liveKeyA, {
      apiKeyId: rid("key"),
      projectId: projA,
      organizationId: orgA,
      env: "live",
    });
    registerDevKey(testKeyA, {
      apiKeyId: rid("key"),
      projectId: projA,
      organizationId: orgA,
      env: "test",
    });
    registerDevKey(liveKeyB, {
      apiKeyId: rid("key"),
      projectId: projB,
      organizationId: orgB,
      env: "live",
    });
    registerDevKey(liveKeyC, {
      apiKeyId: rid("key"),
      projectId: projC,
      organizationId: orgC,
      env: "live",
    });

    // Seed org A at the cap in ONE statement (not 5k round trips). Rows are
    // status 'sent' so the drain claims never touch them; acceptance-counts
    // count every live row in the period regardless of status.
    await db.execute(sql`
      INSERT INTO emails (id, project_id, "from", "to", subject, text, status)
      SELECT ${rid("em_seed")} || '_' || g, ${projA}, 'seed@test.test', 'r@test.test', 'seed', 'x', 'sent'
      FROM generate_series(1, ${FREE_LIMIT}) AS g
    `);
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    for (const orgId of [orgA, orgB, orgC]) {
      await db.delete(organizations).where(eq(organizations.id, orgId));
    }
    await db.delete(subscriptions).where(eq(subscriptions.organizationId, orgB));
    if (planCreatedBySuite) await db.delete(plans).where(eq(plans.id, planId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("live send at the plan limit is refused with plan_limit_reached and persists nothing", async () => {
    const res = await postEmails(liveKeyA, {
      from: `a-${suffix}@test.test`,
      to: "r@test.test",
      subject: "over quota",
      text: "x",
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      error: {
        code: string;
        message: string;
        details?: { limit: number; usage: number };
        fix?: string;
      };
    };
    expect(body.error.code).toBe("plan_limit_reached");
    expect(body.error.details?.limit).toBe(FREE_LIMIT);
    expect(body.error.details?.usage).toBe(FREE_LIMIT);
    expect(body.error.fix ?? "").toMatch(/upgrade/i);

    // Nothing persisted for the refused send.
    const db = getDb();
    const countRows = await db
      .select({ value: count() })
      .from(emails)
      .where(eq(emails.projectId, projA));
    expect(Number(countRows[0]?.value ?? 0)).toBe(FREE_LIMIT);
  });

  it("batch ingest applies the quota gate per message", async () => {
    const res = await app.request("/v1/emails/batch", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${liveKeyA}` },
      body: JSON.stringify({
        from: `a-${suffix}@test.test`,
        messages: [
          { to: "b1@test.test", subject: "s", text: "x" },
          { to: "b2@test.test", subject: "s", text: "x" },
        ],
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      data: {
        accepted: number;
        skipped: number;
        results: Array<{ status: string; reason?: string }>;
      };
    };
    expect(body.data.accepted).toBe(0);
    expect(body.data.results).toHaveLength(2);
    for (const r of body.data.results) {
      expect(r.status).toBe("skipped");
      expect(r.reason ?? "").toMatch(/plan allows|exceed the limit/i);
    }
  });

  it("test-key sends are never limited even when the org is at cap", async () => {
    const res = await postEmails(testKeyA, {
      from: `a-${suffix}@test.test`,
      to: "t@test.test",
      subject: "test email",
      text: "x",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string };
    const db = getDb();
    const [row] = await db.select().from(emails).where(eq(emails.id, body.id)).limit(1);
    expect(row?.env).toBe("test");
  });

  it("under-limit org accepts live sends (env stamped live)", async () => {
    const res = await postEmails(liveKeyB, {
      from: `b-${suffix}@test.test`,
      to: "r@test.test",
      subject: "fine",
      text: "x",
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string };
    const db = getDb();
    const [row] = await db.select().from(emails).where(eq(emails.id, body.id)).limit(1);
    expect(row?.env).toBe("live");
  });

  it("test rows drain through the mock provider only, and are never metered", async () => {
    const db = getDb();
    // Find the test-env queued row from the at-cap org.
    const [testRow] = await db
      .select()
      .from(emails)
      .where(and(eq(emails.projectId, projA), eq(emails.status, "queued"), eq(emails.env, "test")))
      .limit(1);
    expect(testRow).toBeTruthy();

    await drainPendingEmails(getDb(), { batch: 100 });

    const [after] = await db.select().from(emails).where(eq(emails.id, testRow!.id)).limit(1);
    expect(after?.status).toBe("sent");
    expect(after?.provider).toBe("mock");
    expect(after?.transport).toBe("mock");

    // No ledger row for the test send.
    const [ledger] = await db
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${testRow!.id}`));
    expect(Number(ledger?.value ?? 0)).toBe(0);
  }, 60_000);

  it("ledger writes are exactly-once across retries and replays", async () => {
    const db = getDb();
    const emailId = rid("em_meter");
    await db.insert(emails).values({
      id: emailId,
      projectId: projB,
      from: "m@test.test",
      to: "r@test.test",
      subject: "meter",
      text: "x",
      status: "sent",
    });
    const first = await recordSendUsage(db, { emailId, projectId: projB, env: "live" });
    const retry = await recordSendUsage(db, { emailId, projectId: projB, env: "live" });
    const replay = await recordSendUsage(db, { emailId, projectId: projB, env: "live" });
    expect(first).toBe(true);
    expect(retry).toBe(false);
    expect(replay).toBe(false);
    const ledgerRows = await db
      .select({ value: count() })
      .from(usageRecords)
      .where(eq(usageRecords.id, `ur_${emailId}`));
    expect(Number(ledgerRows[0]?.value ?? 0)).toBe(1);

    // Test-env deliveries are never metered.
    expect(await recordSendUsage(db, { emailId: rid("em_t"), projectId: projB, env: "test" })).toBe(
      false
    );
  });

  it("aggregation is idempotent: re-running converges to the same summary", async () => {
    const db = getDb();
    const n1 = await aggregateUsageNow(db);
    const db2 = getDb();
    const n2 = await aggregateUsageNow(db2);
    // Contract consumed by POST /cron/aggregate-usage: { orgs, rows }.
    expect(n1.rows).toBeGreaterThanOrEqual(1);
    expect(n1.orgs).toBeGreaterThanOrEqual(1);
    // Convergence: a re-run folds the same orgs into the same rollups.
    expect(n2).toEqual(n1);

    const rows1 = await db
      .select()
      .from(usageSummaries)
      .where(and(eq(usageSummaries.organizationId, orgB)));
    const rows2 = await getDb()
      .select()
      .from(usageSummaries)
      .where(and(eq(usageSummaries.organizationId, orgB)));
    expect(rows2).toEqual(rows1);
    // The rollup must equal the ledger sum for the period — org B metered
    // every live delivery it accepted (the under-limit send plus the explicit
    // meter row), and nothing else.
    const [ledgerSum] = await db
      .select({ value: sql<number>`coalesce(sum(${usageRecords.quantity}), 0)` })
      .from(usageRecords)
      .where(eq(usageRecords.organizationId, orgB));
    expect(rows1[0]?.quantity).toBe(Number(ledgerSum?.value ?? 0));
    expect(rows1[0]?.quantity).toBeGreaterThanOrEqual(1);
  });

  it("subscription period stamps anchor the usage window (rollover keeps cycle day)", async () => {
    const db = getDb();
    await db.insert(subscriptions).values({
      id: rid("sub"),
      organizationId: orgB,
      planId,
      status: "active",
      currentPeriodStart: new Date("2025-01-15T10:00:00Z"),
      currentPeriodEnd: new Date("2025-02-15T10:00:00Z"),
    });
    const period = await orgUsagePeriod(db, orgB, new Date());
    const now = Date.now();
    expect(period.start.getTime()).toBeLessThanOrEqual(now);
    expect(period.end.getTime()).toBeGreaterThan(now);
    // Cycle-preserving: still anchored to the 15th, not the 1st.
    expect(period.start.getUTCDate()).toBe(15);
    expect(period.end.getUTCDate()).toBe(15);
    await db.delete(subscriptions).where(eq(subscriptions.organizationId, orgB));
  });

  it("gmail daily cap counts only gmail-transported sends (exact accounting)", async () => {
    const db = getDb();
    // Cap 3; today this project already sent 2 via Gmail and 4 via SES.
    // Old (buggy) accounting saw 6 and tripped the cap; exact accounting
    // sees 2 < 3 and must NOT raise it.
    await db.insert(projectTransports).values({
      id: rid("ptr"),
      projectId: projC,
      type: "gmail",
      label: "gmail@test.test",
      status: "active",
      isDefault: true,
      // Structurally valid envelope, cryptographically garbage: construction
      // fails distinctly from the cap refusal, which is what we assert on.
      encryptedCredentials: { iv: "AA==", ciphertext: "AA==", tag: "AA==" },
      dailyCap: 3,
    });
    for (const [transport, n] of [
      ["gmail", 2],
      ["ses", 4],
    ] as const) {
      await db.execute(sql`
        INSERT INTO emails (id, project_id, "from", "to", subject, text, status, transport)
        SELECT ${rid("em_gm")} || '_' || g, ${projC}, 'g@test.test', 'r@test.test', 'hist', 'x', 'sent', ${transport}
        FROM generate_series(1, ${n}) AS g
      `);
    }

    const res1 = await postEmails(liveKeyC, {
      from: `c-${suffix}@test.test`,
      to: "r@test.test",
      subject: "cap probe 1",
      text: "x",
    });
    expect(res1.status).toBe(202);
    const id1 = ((await res1.json()) as { id: string }).id;
    // The route auto-drains; drive an explicit drain too in case the kick
    // hasn't run yet, then wait for the row to settle.
    await drainPendingEmails(getDb(), { batch: 50 }).catch(() => {});
    const after1 = await waitSettled(id1);
    expect(after1?.status).not.toBe("queued");
    expect(after1?.lastError ?? "").not.toMatch(/daily cap/i);

    // At the real cap (2 of 2): the NEXT send must hit exactly this
    // refusal — proof the cap still fires when truly exhausted.
    await db
      .update(projectTransports)
      .set({ dailyCap: 2 })
      .where(eq(projectTransports.projectId, projC));
    const res2 = await postEmails(liveKeyC, {
      from: `c-${suffix}@test.test`,
      to: "r@test.test",
      subject: "cap probe 2",
      text: "x",
    });
    expect(res2.status).toBe(202);
    const id2 = ((await res2.json()) as { id: string }).id;
    await drainPendingEmails(getDb(), { batch: 50 }).catch(() => {});
    const after2 = await waitSettled(id2);
    expect(after2?.lastError ?? "").toMatch(/Gmail daily cap reached/i);
    await db.delete(projectTransports).where(eq(projectTransports.projectId, projC));
  }, 60_000);
});
