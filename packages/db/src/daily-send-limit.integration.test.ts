import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "./client.js";
import { organizations } from "./schema/organizations.js";
import { projects } from "./schema/projects.js";
import { emails } from "./schema/emails.js";
import { plans, subscriptions } from "./schema/billing.js";
import { checkOrganizationQuota, orgUsageSnapshot } from "./usage.js";
import { withOrganizationSendingEligibility } from "./organization-sending.js";

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;
gate("daily organization send limit (Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID();
  const org = `org_daily_${suffix}`;
  const p1 = `p1_${suffix}`;
  const p2 = `p2_${suffix}`;
  const now = new Date("2026-11-05T12:00:00Z");
  beforeAll(async () => {
    await db.execute(sql`select 1`);
    await db.insert(organizations).values({
      id: org,
      name: "Daily test",
      slug: suffix,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await db.insert(projects).values([
      { id: p1, organizationId: org, name: "One", slug: "one" },
      { id: p2, organizationId: org, name: "Two", slug: "two" },
    ]);
    await db.execute(sql`
      INSERT INTO emails (id, project_id, "from", "to", subject, text, status, env, created_at)
      SELECT ${`seed_${suffix}_`} || g, ${p1}, 'a@example.test', 'b@example.test', 'test', 'test', 'failed', 'live', ${now.toISOString()}::timestamptz
      FROM generate_series(1, 499) g
    `);
  });
  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, org));
    await closeDb();
  });
  it("serializes concurrent live admissions across projects; refuses after 500", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const projectId = i % 2 ? p1 : p2;
        return withOrganizationSendingEligibility(
          db,
          { organizationId: org, projectId, env: "live", now },
          async (tx, _organization, admittedAt) => {
            await tx.insert(emails).values({
              id: `em_${randomUUID()}`,
              projectId,
              from: "a@example.test",
              to: "b@example.test",
              subject: "test",
              text: "test",
              status: "queued",
              env: "live",
              createdAt: admittedAt,
            });
          }
        );
      })
    );
    expect(attempts.filter((x) => x.allowed)).toHaveLength(1);
    expect(attempts.filter((x) => !x.allowed)).toHaveLength(9);
    expect(attempts.find((x) => !x.allowed)?.decision.quota).toMatchObject({
      window: "daily",
      limit: 500,
      usage: 500,
    });
    expect(await orgUsageSnapshot(db, org, now)).toMatchObject({
      dailyAcceptedLive: 500,
      dailyLimit: 500,
    });
  }, 30000);
  it("allows paid plans and internal traffic independently of the Beginner daily cap", async () => {
    const [plan] = await db
      .insert(plans)
      .values({ id: `plan_${suffix}`, tier: "starter", name: "Starter" })
      .onConflictDoUpdate({ target: plans.tier, set: { tier: "starter" } })
      .returning();
    await db
      .insert(subscriptions)
      .values({ id: `sub_${suffix}`, organizationId: org, planId: plan!.id, status: "active" });
    expect((await checkOrganizationQuota(db, org, "live", 1, now)).allowed).toBe(true);
    expect(await checkOrganizationQuota(db, "org_avenor", "live", 1, now)).toMatchObject({
      allowed: true,
      reason: "internal-org",
    });
    await db.delete(subscriptions).where(eq(subscriptions.organizationId, org));
    if (plan!.id === `plan_${suffix}`) await db.delete(plans).where(eq(plans.id, plan!.id));
  });

  it("exempts test keys and resets at UTC midnight without resetting monthly usage", async () => {
    expect((await checkOrganizationQuota(db, org, "test", 1, now)).allowed).toBe(true);
    const next = await checkOrganizationQuota(db, org, "live", 1, new Date("2026-11-06T00:00:00Z"));
    expect(next.allowed).toBe(true);
    expect(next.usage).toBe(500);
    expect(
      (await orgUsageSnapshot(db, org, new Date("2026-11-06T00:00:00Z"))).dailyAcceptedLive
    ).toBe(0);
  });
});
