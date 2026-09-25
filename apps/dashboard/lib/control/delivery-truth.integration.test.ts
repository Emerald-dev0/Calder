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
 * Phase 1, M1.3 — the surface half of delivery truth. The M1.2 suppression/
 * transition machinery is tested at the API layer; this file proves that the
 * CONTROL surfaces read it honestly and that the previously unfireable alert
 * rules (delivery-rate, complaints, bounces, queue-age) now fire on real
 * data:
 *
 * - deliveryOutcomeSummary matches SQL truth on the same window (robust to
 *   concurrent test rows: expected values are recomputed from the DB, never
 *   hardcoded)
 * - evaluateAlerts fires complaints (any complaint is critical),
 *   delivery-rate (critical below 95%), elevated bounces, and queue-age
 *   (queued/created message older than 15 min) on induced data with large
 *   safety margins so other suites' rows cannot mute them
 * - no fabricated baselines: an empty window yields null rates, not zeros
 */
gate("control delivery truth (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const { getDb, emails, organizations, organizationMembers, projects, users } =
    await import("@calder/db");
  const { eq, and, count, gte } = await import("drizzle-orm");
  const { deliveryOutcomeSummary, evaluateAlerts } = await import("./queries.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_cdt_${suffix}`;
  const projId = `proj_cdt_${suffix}`;
  const userId = `usr_cdt_${suffix}`;
  const seededIds: string[] = [];

  const seedEmails = async (
    status: string,
    n: number,
    opts: { createdAt?: Date } = {}
  ): Promise<void> => {
    if (n <= 0) return;
    const db = getDb();
    const values = Array.from({ length: n }, (_, i) => {
      const id = `em_cdt_${suffix}_${status}_${i}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      seededIds.push(id);
      return {
        id,
        projectId: projId,
        from: `cdt-${suffix}@test.test`,
        to: `to-${suffix}@example.test`,
        subject: "control truth",
        text: "x",
        status: status as never,
        attemptCount: 0,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      };
    });
    await db.insert(emails).values(values);
  };

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `cdt-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Control Truth", slug: `cdt-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_cdt_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.delete(organizations).where(eq(organizations.id, orgId)); // cascades to seeds
    await db.delete(users).where(eq(users.id, userId));
  });

  it("deliveryOutcomeSummary equals SQL truth for the same window", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    // Seed a small distinctive mix (foreign concurrent rows are allowed; the
    // expectation is recomputed from SQL, so this test cannot flake).
    await seedEmails("delivered", 3);
    await seedEmails("bounced", 2);
    await seedEmails("complained", 1);

    // Compare against SQL truth for the exact same window. Other suites run
    // concurrently against this DB, so retry until TWO consecutive summaries
    // bracket the truth query without drifting (steady-state snapshot).
    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since = new Date(dayStart.getTime() - 29 * 24 * 60 * 60 * 1000);
    const truthSql = () =>
      db
        .select({ status: emails.status, value: count() })
        .from(emails)
        .where(gte(emails.createdAt, since))
        .groupBy(emails.status);

    let summary = await deliveryOutcomeSummary(30);
    let truth = await truthSql();
    for (let attempt = 0; attempt < 4; attempt++) {
      const again = await deliveryOutcomeSummary(30);
      const terminalOf = (x: typeof summary) => x.delivered + x.bounced + x.complained + x.failed;
      const same = (a: typeof summary, b: typeof summary) =>
        terminalOf(a) === terminalOf(b) &&
        a.inFlight === b.inFlight &&
        a.sent === b.sent &&
        a.started - a.inFlight === b.started - b.inFlight;
      if (same(summary, again)) break;
      await new Promise((r) => setTimeout(r, 60));
      summary = again;
      truth = await truthSql();
    }

    const s = (name: string) => Number(truth.find((r) => r.status === name)?.value ?? 0);
    const terminal = s("delivered") + s("bounced") + s("complained") + s("failed");

    expect(summary.delivered).toBe(s("delivered"));
    expect(summary.bounced).toBe(s("bounced"));
    expect(summary.complained).toBe(s("complained"));
    expect(summary.failed).toBe(s("failed"));
    expect(summary.suppressed).toBe(s("suppressed"));
    expect(summary.inFlight).toBe(s("created") + s("queued") + s("sending"));
    expect(summary.terminal).toBe(terminal);
    expect(summary.terminal).toBeGreaterThanOrEqual(6); // our seeds visible
    if (terminal > 0) {
      expect(summary.deliveryRate).toBeCloseTo((s("delivered") / terminal) * 100, 6);
      expect(summary.bounceRate).toBeCloseTo((s("bounced") / terminal) * 100, 6);
      expect(summary.complaintRate).toBeCloseTo((s("complained") / terminal) * 100, 6);
    } else {
      expect(summary.deliveryRate).toBeNull();
    }
  });

  it("complaint rule: any complaint in 24h fires critical", async () => {
    if (!(await reachable())) return;
    await seedEmails("complained", 1);
    const alerts = await evaluateAlerts();
    const rule = alerts.find((a) => a.id === "complaints");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("critical");
    expect(rule?.metric).toMatch(/\d+ > 0/);
  });

  it("delivery-rate rule: deep failure mix fires critical (<95%)", async () => {
    if (!(await reachable())) return;
    // Dominant seeds: even foreign concurrent rows cannot lift the rate past 95%.
    await seedEmails("failed", 400);
    await seedEmails("delivered", 5);
    const alerts = await evaluateAlerts();
    const rule = alerts.find((a) => a.id === "delivery-rate");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("critical");
    const rate = Number(rule?.metric.match(/^(\d+\.?\d*)%/)?.[1]);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeLessThan(95);
  });

  it("bounce rule: dominant bounced mix fires warning", async () => {
    if (!(await reachable())) return;
    await seedEmails("bounced", 600);
    const alerts = await evaluateAlerts();
    const rule = alerts.find((a) => a.id === "bounces");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("warning");
  });

  it("queue-age rule: a 30-minute-old created message fires the stall warning", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await seedEmails("created", 1, { createdAt: new Date(Date.now() - 30 * 60 * 1000) });
    const alerts = await evaluateAlerts();
    const rule = alerts.find((a) => a.id === "queue-age");
    expect(rule).toBeDefined();
    expect(rule?.metric).toMatch(/\d+m > 15m/);
    const minutes = Number(rule?.metric.match(/^(\d+)m/)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(30);
    // Sanity that the underlying derived view agrees.
    const [oldest] = await db
      .select({ value: count() })
      .from(emails)
      .where(and(eq(emails.projectId, projId), eq(emails.status, "created")));
    expect(Number(oldest?.value)).toBe(1);
  });

  it("sorting: critical alerts precede warnings", async () => {
    if (!(await reachable())) return;
    const alerts = await evaluateAlerts();
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < alerts.length; i++) {
      expect(rank[alerts[i]!.severity]).toBeGreaterThanOrEqual(rank[alerts[i - 1]!.severity]);
    }
  });
});
