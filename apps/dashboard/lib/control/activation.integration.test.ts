import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  closeDb,
  emails,
  getDb,
  organizationMembers,
  organizations,
  projects,
  senderIdentities,
  users,
} from "@calder/db";
import { organizationActivation } from "./activation";
import { deliveryOutcomeSummary, queueDerived } from "./queries";
import { parseRange } from "./range";

describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "activation and environment reports (Postgres)",
  () => {
    const prefix = `activation_${randomUUID()}`;
    const orgs = [0, 1, 2, 3].map((n) => `${prefix}_org${n}`);
    const pid = `${prefix}_project`,
      sender = `${prefix}_sender`,
      uid = `${prefix}_owner`;
    const window = parseRange("custom", "2042-05-01", "2042-05-02");
    beforeAll(async () => {
      const db = getDb();
      await db
        .insert(users)
        .values({ id: uid, email: `${prefix}@example.invalid`, emailVerifiedAt: new Date() });
      await db.insert(organizations).values(
        orgs.map((id) => ({
          id,
          name: "Activation QA",
          slug: id,
          createdAt: new Date("2042-05-01T12:00:00Z"),
        }))
      );
      await db.insert(organizationMembers).values(
        [0, 2].map((n) => ({
          id: `${prefix}_member${n}`,
          organizationId: orgs[n]!,
          userId: uid,
          role: "owner" as const,
        }))
      );
      await db.insert(projects).values(
        [0, 1, 2].map((n) => ({
          id: n === 0 ? pid : `${prefix}_p${n}`,
          organizationId: orgs[n]!,
          name: "QA",
          slug: `qa${n}`,
        }))
      );
      await db.insert(senderIdentities).values({
        id: sender,
        projectId: pid,
        displayName: "QA",
        email: "qa@example.invalid",
        type: "gmail",
        status: "connected",
      });
      await db.insert(emails).values([
        {
          id: `${prefix}_mock`,
          projectId: pid,
          from: "qa@example.invalid",
          to: "qa@example.invalid",
          subject: "QA",
          env: "live",
          status: "sent",
          provider: "mock",
          providerMessageId: "mock_qa",
        },
        {
          id: `${prefix}_test`,
          projectId: pid,
          from: "qa@example.invalid",
          to: "qa@example.invalid",
          subject: "QA",
          env: "test",
          status: "delivered",
          provider: "ses",
          providerMessageId: "test_qa",
        },
        {
          id: `${prefix}_queued`,
          projectId: pid,
          from: "qa@example.invalid",
          to: "qa@example.invalid",
          subject: "QA",
          env: "test",
          status: "queued",
        },
      ]);
    });
    afterAll(async () => {
      await getDb().delete(organizations).where(inArray(organizations.id, orgs));
      await getDb().delete(users).where(eq(users.id, uid));
      await closeDb();
    });
    it("counts organizations, not members or projects, and excludes mock/test activation", async () => {
      expect(await organizationActivation(window)).toEqual({
        organizations: 4,
        verified: 2,
        projects: 2,
        senders: 1,
        activated: 0,
      });
      await getDb()
        .insert(emails)
        .values({
          id: `${prefix}_live`,
          projectId: pid,
          from: "qa@example.invalid",
          to: "qa@example.invalid",
          subject: "QA",
          env: "live",
          status: "sent",
          provider: "ses",
          providerMessageId: "ses_qa",
        });
      expect((await organizationActivation(window)).activated).toBe(1);
    });
    it("uses current sender readiness; archived senders don't certify activation", async () => {
      await getDb()
        .update(senderIdentities)
        .set({ archivedAt: new Date() })
        .where(eq(senderIdentities.id, sender));
      expect((await organizationActivation(window)).senders).toBe(0);
      expect((await organizationActivation(window)).activated).toBe(0);
    });
    it("separates live/test statuses and backlog without changing all-environment compatibility", async () => {
      const [live, test, all] = await Promise.all([
        deliveryOutcomeSummary(30, "live", orgs[0]),
        deliveryOutcomeSummary(30, "test", orgs[0]),
        deliveryOutcomeSummary(30, "all", orgs[0]),
      ]);
      expect(all.started).toBe(live.started + test.started);
      expect(test.delivered).toBeGreaterThanOrEqual(1);
      const [lq, tq, aq] = await Promise.all([
        queueDerived("live", orgs[0]),
        queueDerived("test", orgs[0]),
        queueDerived("all", orgs[0]),
      ]);
      expect(aq.inFlight).toBe(lq.inFlight + tq.inFlight);
      expect(tq.inFlight).toBeGreaterThanOrEqual(1);
    });
    it("reports an empty cohort as actual zeros", async () => {
      const empty = await organizationActivation(parseRange("custom", "2043-05-01", "2043-05-02"));
      expect(Object.values(empty).every((n) => n === 0)).toBe(true);
    });
  }
);
