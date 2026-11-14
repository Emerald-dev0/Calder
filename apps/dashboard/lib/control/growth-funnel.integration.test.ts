import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { apiKeys, closeDb, emails, getDb, organizations, projects } from "@calder/db";
import { activationFunnel } from "./growth-funnel";

/**
 * Activation against a live Postgres. The page's whole value is that the
 * numbers match the tables, so the assertions here are about *stages agreeing
 * with rows*, not about a particular count: the database this runs against may
 * already hold accounts from other suites.
 */

const gate = process.env.RUN_INTEGRATION_TESTS === "1" ? describe : describe.skip;

gate("activation funnel (live Postgres)", () => {
  const db = getDb();
  const suffix = randomUUID().slice(0, 8);

  const sendingOrg = `org_funnel_send_${suffix}`;
  const projectOnlyOrg = `org_funnel_proj_${suffix}`;
  const bareOrg = `org_funnel_bare_${suffix}`;
  const since = new Date(Date.now() - 5 * 60 * 1000);

  beforeAll(async () => {
    await db.execute(sql`select 1`);
    await db.insert(organizations).values([
      { id: sendingOrg, name: `Funnel send ${suffix}`, slug: `funnel-send-${suffix}` },
      { id: projectOnlyOrg, name: `Funnel project ${suffix}`, slug: `funnel-proj-${suffix}` },
      { id: bareOrg, name: `Funnel bare ${suffix}`, slug: `funnel-bare-${suffix}` },
    ]);

    const project = `prj_funnel_${suffix}`;
    await db.insert(projects).values([
      { id: project, organizationId: sendingOrg, name: "Funnel", slug: "funnel" },
      { id: `${project}_p2`, organizationId: projectOnlyOrg, name: "Funnel", slug: "funnel" },
    ]);

    await db.insert(apiKeys).values({
      id: `key_funnel_${suffix}`,
      projectId: project,
      name: "funnel key",
      keyPrefix: "calder_sk_test_funnel...",
      keyHash: `hash_funnel_${suffix}`,
      env: "test",
    });

    await db.insert(emails).values({
      id: `eml_funnel_${suffix}`,
      projectId: project,
      from: "funnel@example.com",
      to: "someone@example.com",
      subject: "Activation",
      status: "sent",
      env: "test",
    });
  });

  afterAll(async () => {
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [sendingOrg, projectOnlyOrg, bareOrg]));
    await closeDb();
  });

  it("reports stages that agree with the rows the suites just wrote", async () => {
    const funnel = await activationFunnel({ since, recentLimit: 200 });
    const byKey = new Map(funnel.stages.map((s) => [s.key, s.orgs]));

    // Every stage is a count of distinct accounts inside the same cohort, read
    // in one repeatable-read transaction. That — not nesting — is the property
    // that can be guaranteed: a stage may exceed the one above it when an
    // account skipped that step (a dashboard send needs no API key), but no
    // stage can ever exceed the cohort it is drawn from.
    for (const stage of funnel.stages) {
      expect(byKey.get(stage.key), `${stage.key} has no count`).toBeTypeOf("number");
      expect(stage.orgs, `${stage.key} exceeds the cohort`).toBeLessThanOrEqual(funnel.cohort);
      expect(stage.orgs, `${stage.key} is negative`).toBeGreaterThanOrEqual(0);
    }

    const row = (id: string) => funnel!.recent.find((r) => r.organizationId === id);
    expect(row(sendingOrg)).toMatchObject({ projects: 1, activeKeys: 1, sentLive: false });
    expect(row(sendingOrg)?.firstSendAt).toBeInstanceOf(Date);
    expect(row(projectOnlyOrg)).toMatchObject({ projects: 1, activeKeys: 0 });
    expect(row(projectOnlyOrg)?.firstSendAt).toBeNull();
    expect(row(bareOrg)).toMatchObject({ projects: 0, activeKeys: 0 });
  });

  it("measures time to first send only for accounts that sent", async () => {
    const funnel = await activationFunnel({ since, recentLimit: 200 });
    const sending = funnel.recent.filter((r) => r.organizationId === sendingOrg);
    expect(sending).toHaveLength(1);
    // The email was inserted within the same test run, so the median is a
    // small number of hours — never negative, never NaN.
    expect(funnel.medianHoursToFirstSend).not.toBeNull();
    expect(funnel.medianHoursToFirstSend!).toBeGreaterThanOrEqual(0);
  });
});
