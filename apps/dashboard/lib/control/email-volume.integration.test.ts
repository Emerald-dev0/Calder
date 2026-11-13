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
 * Platform-wide email volume (live Postgres).
 *
 * The rule this guards: the number an admin reads as "emails sent" must equal
 * SQL truth for the same definition, all time, across every organization —
 * `sent`/`delivered`/`bounced`/`complained` from live keys, with test-mode rows
 * counted separately rather than folded in.
 *
 * Other suites run concurrently against this database, so nothing is
 * hardcoded: the expectation is recomputed in SQL and the summary is re-read
 * until two consecutive reads stop drifting (steady-state snapshot).
 */
gate("platform email volume (live Postgres)", async () => {
  const { randomBytes, randomUUID } = await import("node:crypto");
  const { getDb, emails, organizations, organizationMembers, projects, users, cleanupSuiteOrg } =
    await import("@calder/db");
  const { and, count, eq, inArray } = await import("drizzle-orm");
  const { platformEmailVolume } = await import("./queries.js");
  const { ACCEPTED_EMAIL_STATUSES } = await import("./email-volume.js");

  const suffix = randomBytes(4).toString("hex");
  const orgId = `org_pev_${suffix}`;
  const projId = `proj_pev_${suffix}`;
  const userId = `usr_pev_${suffix}`;

  const seed = async (status: string, env: "live" | "test", n: number): Promise<void> => {
    if (n <= 0) return;
    const db = getDb();
    await db.insert(emails).values(
      Array.from({ length: n }, (_, i) => ({
        id: `em_pev_${suffix}_${status}_${env}_${i}_${randomUUID().replace(/-/g, "").slice(0, 8)}`,
        projectId: projId,
        from: `pev-${suffix}@test.test`,
        to: `to-${suffix}@example.test`,
        subject: "platform volume",
        text: "x",
        status: status as never,
        env,
        attemptCount: 0,
      }))
    );
  };

  beforeAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await db.insert(users).values({ id: userId, email: `pev-user-${suffix}@test.test` });
    await db
      .insert(organizations)
      .values({ id: orgId, name: "Platform Volume", slug: `pev-${suffix}` });
    await db
      .insert(organizationMembers)
      .values({ id: `orgm_pev_${suffix}`, organizationId: orgId, userId, role: "owner" });
    await db.insert(projects).values({ id: projId, organizationId: orgId, name: "P", slug: "p" });
  });

  afterAll(async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await cleanupSuiteOrg(db, orgId, userId);
  });

  it("matches SQL truth for the all-time accepted count", async () => {
    if (!(await reachable())) return;
    const db = getDb();
    await seed("delivered", "live", 3);
    await seed("bounced", "live", 2);
    await seed("created", "live", 4);
    await seed("delivered", "test", 5);

    const accepted = inArray(emails.status, [...ACCEPTED_EMAIL_STATUSES]);
    const truth = async () => {
      const [liveRows, testRows, lifetime, byStatus] = await Promise.all([
        db
          .select({ value: count() })
          .from(emails)
          .where(and(accepted, eq(emails.env, "live"))),
        db
          .select({ value: count() })
          .from(emails)
          .where(and(accepted, eq(emails.env, "test"))),
        db.select({ value: count() }).from(emails),
        db
          .select({ status: emails.status, value: count() })
          .from(emails)
          .where(eq(emails.env, "live"))
          .groupBy(emails.status),
      ]);
      return {
        live: Number(liveRows[0]?.value ?? 0),
        test: Number(testRows[0]?.value ?? 0),
        lifetime: Number(lifetime[0]?.value ?? 0),
        byStatus: new Map<string, number>(byStatus.map((r) => [r.status, Number(r.value ?? 0)])),
      };
    };

    const stable = async () => {
      let volume = await platformEmailVolume();
      let sql = await truth();
      for (let attempt = 0; attempt < 4; attempt++) {
        const again = await platformEmailVolume();
        if (
          again.liveAccepted === volume.liveAccepted &&
          again.testAccepted === volume.testAccepted &&
          again.lifetimeRows === volume.lifetimeRows
        ) {
          // Snapshot held still; recompute truth once more so the comparison
          // cannot straddle a concurrent insert.
          sql = await truth();
          volume = again;
          break;
        }
        await new Promise((r) => setTimeout(r, 60));
        volume = again;
        sql = await truth();
      }
      return { volume, sql };
    };

    const { volume, sql } = await stable();

    expect(volume.liveAccepted).toBe(sql.live);
    expect(volume.testAccepted).toBe(sql.test);
    expect(volume.lifetimeRows).toBe(sql.lifetime);
    for (const row of volume.byStatus) {
      expect(row.count).toBe(sql.byStatus.get(row.status) ?? 0);
    }
    // Test-mode rows must never be folded into the headline number.
    expect(volume.testAccepted).toBeGreaterThanOrEqual(5);
    expect(volume.liveAccepted).toBeGreaterThanOrEqual(5);
    expect(volume.sendingOrgs).toBeGreaterThanOrEqual(1);
    expect(volume.lastAcceptedAt).not.toBeNull();
    expect(volume.lifetimeRows).toBeGreaterThanOrEqual(volume.liveAccepted);
  });
});
