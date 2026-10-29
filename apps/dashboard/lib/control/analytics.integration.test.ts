import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { analyticsEvents, closeDb, getDb, users } from "@calder/db";
import { trafficTotals } from "./analytics-queries";
import { systemAudiences } from "./queries";
import { parseRange } from "./range";

// Explicitly gated; connection/setup errors fail rather than returning a false pass.
describe.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
  "founder traffic analytics (Postgres)",
  () => {
    const prefix = `analytics_qa_${randomUUID()}`;
    const ids = [1, 2, 3, 4, 5].map((n) => `${prefix}_${n}`);
    const window = parseRange("custom", "2041-03-01", "2041-03-02");
    beforeAll(async () => {
      const db = getDb();
      await db.execute(sql`select 1`);
      await db.insert(users).values({ id: `${prefix}_user`, email: `${prefix}@example.invalid` });
      await db.insert(analyticsEvents).values([
        {
          id: ids[0]!,
          type: "pageview",
          sessionId: prefix,
          visitorId: prefix,
          createdAt: new Date("2041-03-01T10:00:00Z"),
        },
        {
          id: ids[1]!,
          type: "cta_click",
          sessionId: prefix,
          visitorId: prefix,
          createdAt: new Date("2041-03-01T10:00:15Z"),
        },
        {
          id: ids[2]!,
          type: "pageview",
          sessionId: prefix,
          visitorId: prefix,
          createdAt: new Date("2041-03-01T10:01:00Z"),
        },
        {
          id: ids[3]!,
          type: "form_start",
          sessionId: prefix,
          visitorId: prefix,
          createdAt: new Date("2041-03-01T10:01:05Z"),
        },
        {
          id: ids[4]!,
          type: "pageview",
          sessionId: prefix,
          visitorId: prefix,
          createdAt: new Date("2041-03-02T00:00:00Z"),
        },
      ]);
    });
    afterAll(async () => {
      await getDb().delete(analyticsEvents).where(inArray(analyticsEvents.id, ids));
      await getDb()
        .delete(users)
        .where(eq(users.id, `${prefix}_user`));
      await closeDb();
    });
    it("executes audience activity cutoff with a Postgres timestamp, including users never seen", async () => {
      const audiences = await systemAudiences();
      expect(
        audiences.find((audience) => audience.key === "inactive")?.count
      ).toBeGreaterThanOrEqual(1);
      expect(
        audiences.find((audience) => audience.key === "all_users")?.count
      ).toBeGreaterThanOrEqual(1);
      expect(
        audiences.every((audience) => Number.isFinite(audience.count) && audience.count >= 0)
      ).toBe(true);
    });
    it("does not inflate pageviews/pages-per-session with clicks and form events; excludes end boundary", async () => {
      const totals = await trafficTotals(window);
      expect(totals.pageviews).toBe(2);
      expect(totals.ctaClicks).toBe(1);
      expect(totals.sessions).toBe(1);
      expect(totals.newVisitors).toBe(1);
      expect(totals.returningVisitors).toBe(0);
      expect(totals.pagesPerSession).toBe(2);
      expect(totals.avgSessionSeconds).toBe(60);
    });
    it("does not invent session duration for a one-page session", async () => {
      await getDb().delete(analyticsEvents).where(eq(analyticsEvents.id, ids[2]!));
      const totals = await trafficTotals(window);
      expect(totals.pageviews).toBe(1);
      expect(totals.avgSessionSeconds).toBeNull();
    });
  }
);
