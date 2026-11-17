import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";
const gate = ENABLED ? describe : describe.skip;

const PREFIX = "recon";
const suffix = Date.now().toString(36);
const emails = [`${PREFIX}-a-${suffix}@example.test`, `${PREFIX}-b-${suffix}@example.test`];

/**
 * Mirroring the provider's suppression list.
 *
 * The properties that matter are not "a row was inserted". They are: a page cap
 * does not lose entries silently (it moves the watermark and says it was
 * truncated), a failed run keeps what it managed to read, and nothing is ever
 * deleted — an address vanishing from our mirror is not evidence that AWS
 * cleared it, and deleting the row would quietly re-open a dead mailbox.
 */
gate("SES suppression reconcile (live Postgres)", () => {
  const ORIGINAL = { ...process.env };

  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";
  });

  afterEach(() => {
    process.env = {
      ...ORIGINAL,
      AWS_ACCESS_KEY_ID: "test-key",
      AWS_SECRET_ACCESS_KEY: "test-secret",
    };
  });

  afterAll(async () => {
    const { getDb, sesSuppressions } = await import("@calder/db");
    await getDb().delete(sesSuppressions).where(inArray(sesSuppressions.email, emails));
    process.env = { ...ORIGINAL };
  });

  it("writes what the provider lists, with the provider's reason", async () => {
    const { getDb, sesSuppressions } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");
    const db = getDb();

    const list = vi.fn(async () => ({
      entries: [
        { email: emails[0]!, reason: "BOUNCE" as const, lastUpdateTime: new Date("2026-01-01") },
        { email: emails[1]!, reason: "COMPLAINT" as const, lastUpdateTime: null },
      ],
      nextToken: null,
    }));

    const summary = await reconcileSesSuppressions(db, { list });
    expect(summary).toMatchObject({ skipped: false, pages: 1, truncated: false, failed: false });
    expect(summary.listed).toBe(2);

    const rows = await db
      .select()
      .from(sesSuppressions)
      .where(inArray(sesSuppressions.email, emails));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reason).sort()).toEqual(["BOUNCE", "COMPLAINT"]);
    expect(rows.every((r) => r.source === "reconcile")).toBe(true);
  });

  it("is idempotent: a second run updates rather than duplicates", async () => {
    const { getDb, sesSuppressions } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");
    const db = getDb();

    const list = vi.fn(async () => ({
      entries: [
        { email: emails[0]!, reason: "BOUNCE" as const, lastUpdateTime: new Date("2026-02-02") },
      ],
      nextToken: null,
    }));

    await reconcileSesSuppressions(db, { list });
    const rows = await db
      .select()
      .from(sesSuppressions)
      .where(eq(sesSuppressions.email, emails[0]!));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastUpdateTime?.toISOString()).toContain("2026-02-02");
  });

  it("asks only for entries updated since the watermark, minus a day", async () => {
    const { getDb } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");
    const db = getDb();

    const list = vi.fn(async () => ({ entries: [], nextToken: null }));
    await reconcileSesSuppressions(db, { list });

    const call = list.mock.calls[0] as unknown as [{ since?: Date }];
    const since = call[0].since;
    expect(since).toBeInstanceOf(Date);
    // The watermark is "now" from the first run; the overlap re-reads a day.
    expect(Date.now() - since!.getTime()).toBeGreaterThan(24 * 60 * 60 * 1000 - 60_000);
  });

  it("reports a page cap honestly instead of claiming the listing finished", async () => {
    const { getDb } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");

    let page = 0;
    const list = vi.fn(async () => {
      page += 1;
      return {
        entries: [
          {
            email: `${PREFIX}-page${page}-${suffix}@example.test`,
            reason: "BOUNCE" as const,
            lastUpdateTime: null,
          },
        ],
        nextToken: `token-${page}`,
      };
    });

    const summary = await reconcileSesSuppressions(getDb(), { list, maxPages: 2 });
    expect(summary.pages).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(summary.listed).toBe(2);

    const { getDb: _getDb, sesSuppressions } = await import("@calder/db");
    await _getDb()
      .delete(sesSuppressions)
      .where(
        inArray(sesSuppressions.email, [
          `${PREFIX}-page1-${suffix}@example.test`,
          `${PREFIX}-page2-${suffix}@example.test`,
        ])
      );
  });

  it("keeps partial progress and reports the failure when the listing breaks mid-run", async () => {
    const { getDb, sesSuppressions } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");
    const db = getDb();
    const partial = `${PREFIX}-partial-${suffix}@example.test`;

    let page = 0;
    const list = vi.fn(async () => {
      page += 1;
      if (page === 1) {
        return {
          entries: [{ email: partial, reason: "BOUNCE" as const, lastUpdateTime: null }],
          nextToken: "more",
        };
      }
      throw new Error("provider unavailable");
    });

    const summary = await reconcileSesSuppressions(db, { list, maxPages: 3 });
    expect(summary.failed).toBe(true);
    expect(summary.listed).toBe(1);

    const [row] = await db.select().from(sesSuppressions).where(eq(sesSuppressions.email, partial));
    expect(row).toBeDefined();

    await db.delete(sesSuppressions).where(eq(sesSuppressions.email, partial));
  });

  it("skips cleanly when no provider credentials exist, rather than reporting zero entries", async () => {
    process.env.AWS_ACCESS_KEY_ID = "";
    process.env.AWS_SECRET_ACCESS_KEY = "";
    const { getDb } = await import("@calder/db");
    const { reconcileSesSuppressions } = await import("./ses-suppression-reconcile.js");
    const list = vi.fn();

    const summary = await reconcileSesSuppressions(getDb(), { list });
    expect(summary).toMatchObject({ skipped: true, listed: 0, failed: false });
    expect(list).not.toHaveBeenCalled();
  });
});
