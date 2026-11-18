import { describe, it, expect } from "vitest";

// Gate: needs a live Postgres (local docker). CI-safe skip otherwise.
process.env.RUN_INTEGRATION_TESTS ??= "";
const ENABLED = process.env.RUN_INTEGRATION_TESTS === "1";

const gate = ENABLED ? describe : describe.skip;

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

/**
 * Finishing a list that is bigger than one request.
 *
 * The console sends in runs. What makes that safe is not arithmetic inside a
 * route — it is that "who has this batch already reached?" is read back from the
 * rows that were actually written. So this test writes those rows by hand and
 * asks the two helpers the action uses who is next.
 *
 * It also pins the rule that a *failed* attempt is not a person who has been
 * reached: a provider rejection is not a decision about them, and a second run
 * must try again rather than quietly writing them off.
 */
gate("broadcast runs (live Postgres)", async () => {
  it("continues where the last run stopped, and retries what failed", async () => {
    if (!(await reachable())) return;

    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { inArray } = await import("drizzle-orm");
    const { batchKeyFor, mailedUserIds, recipientKeyFor } =
      await import("./audience-recipients.js");
    const { batchProgress, nextRecipients } = await import("./company-send.js");

    const tag = `run-${Date.now().toString(36)}`;
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    const ids = [`usr_${tag}_1`, `usr_${tag}_2`, `usr_${tag}_3`];

    const batch = batchKeyFor("updates.announcement", "A title", "A body");

    try {
      await db.insert(schema.users).values(
        ids.map((id, index) => ({
          id,
          email: `${id}@example.test`,
          name: `Person ${index + 1}`,
          emailVerifiedAt: new Date(),
          createdAt: new Date(base + index * 1000),
        }))
      );

      // Nothing sent yet: everyone is next.
      expect((await mailedUserIds(db, batch)).size).toBe(0);
      const firstPass = await nextRecipients(db, {
        scope: "selected",
        selectedIds: ids,
        mailedIds: new Set(),
        limit: 10,
      });
      expect(firstPass.map((row) => row.id)).toEqual(ids);

      // One accepted, one refused, one untouched.
      await db.insert(schema.companyEmails).values([
        {
          id: `cmail_${tag}_1`,
          toEmail: `${ids[0]}@example.test`,
          userId: ids[0]!,
          template: "updates.announcement",
          category: "updates",
          subject: "A title",
          status: "sent",
          idempotencyKey: recipientKeyFor(batch, ids[0]!),
          sentAt: new Date(),
          createdAt: new Date(base + 10_000),
        },
        {
          id: `cmail_${tag}_2`,
          toEmail: `${ids[1]}@example.test`,
          userId: ids[1]!,
          template: "updates.announcement",
          category: "updates",
          subject: "A title",
          status: "failed",
          error: "provider_error:MessageRejected",
          idempotencyKey: recipientKeyFor(batch, ids[1]!),
          createdAt: new Date(base + 11_000),
        },
      ]);

      const mailed = await mailedUserIds(db, batch);
      expect([...mailed]).toEqual([ids[0]]);

      const progress = await batchProgress(db, {
        scope: "selected",
        selectedIds: ids,
        mailedIds: mailed,
      });
      expect(progress).toEqual({ total: 3, alreadyMailed: 1, remaining: 2 });

      const secondPass = await nextRecipients(db, {
        scope: "selected",
        selectedIds: ids,
        mailedIds: mailed,
        limit: 10,
      });
      // Person 1 is done; person 2 failed and is retried; person 3 was never
      // attempted. Order is by signup, so the list is stable across runs.
      expect(secondPass.map((row) => row.id)).toEqual([ids[1], ids[2]]);

      // A run sends to `limit` people and leaves the rest: no truncation, no
      // silent drop — the count is what the page puts on the button.
      const oneAtATime = await nextRecipients(db, {
        scope: "selected",
        selectedIds: ids,
        mailedIds: mailed,
        limit: 1,
      });
      expect(oneAtATime.map((row) => row.id)).toEqual([ids[1]]);

      // The wide scope proves the other branch of the where-clause: no scope
      // filter at all, still excluding everybody this batch has reached.
      const wide = await nextRecipients(db, {
        scope: "everyone",
        selectedIds: [],
        mailedIds: mailed,
        limit: 10_000,
      });
      const wideIds = wide.map((row) => row.id);
      expect(wideIds).not.toContain(ids[0]);
      expect(wideIds).toContain(ids[1]);
      expect(wideIds).toContain(ids[2]);
    } finally {
      await db.delete(schema.companyEmails).where(inArray(schema.companyEmails.userId, ids));
      await db.delete(schema.users).where(inArray(schema.users.id, ids));
    }
  });

  it("a note to yourself is not evidence of a send to customers", async () => {
    if (!(await reachable())) return;

    const db = (await import("@calder/db")).getDb();
    const schema = await import("@calder/db");
    const { and, eq } = await import("drizzle-orm");
    const { notOperatorTest } = await import("./company-send.js");

    const tag = `notest-${Date.now().toString(36)}`;
    const template = `test.notoperator.${tag}`;

    try {
      await db.insert(schema.companyEmails).values([
        {
          id: `cmail_${tag}_real`,
          toEmail: "real@example.test",
          template,
          category: "updates",
          subject: "A real send",
          status: "sent",
          idempotencyKey: `${tag}:real`,
          metadata: { title: "Real" },
        },
        {
          id: `cmail_${tag}_test`,
          toEmail: "operator@example.test",
          template,
          category: "updates",
          subject: "A note to myself",
          status: "sent",
          idempotencyKey: `${tag}:test`,
          metadata: { title: "Test", operatorTest: true },
        },
      ]);

      const rows = await db
        .select({ id: schema.companyEmails.id })
        .from(schema.companyEmails)
        .where(and(eq(schema.companyEmails.template, template), notOperatorTest()));

      // Only the real send is evidence. The test row still exists — it is the
      // record that the test happened — but it cannot date a template.
      expect(rows.map((row) => row.id)).toEqual([`cmail_${tag}_real`]);
    } finally {
      await db.delete(schema.companyEmails).where(eq(schema.companyEmails.template, template));
    }
  });
});
