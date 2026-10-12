import { describe, expect, it, vi } from "vitest";
import { attemptVerification } from "./domain-verification.js";
import { expectedTxtValue, newVerificationToken } from "./dns-challenge.js";

/**
 * Probe-mode unit tests with a stubbed Drizzle handle: attemptVerification only
 * touches db.select().from().where().limit(), db.update().set().where() and
 * db.insert().values(), so a minimal chain stub is faithful.
 */

interface StubRow {
  id: string;
  projectId: string;
  domain: string;
  status: "pending" | "verified" | "failed" | "expired";
  verificationToken: string | null;
  verificationExpiresAt: Date | null;
  verifyAttempts: number;
  verifyWindowStart: Date | null;
  verifiedAt: Date | null;
}

function pendingRow(overrides: Partial<StubRow> = {}): StubRow {
  return {
    id: "dom_test",
    projectId: "proj_test",
    domain: "acme.com",
    status: "pending",
    verificationToken: newVerificationToken(),
    verificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    verifyAttempts: 0,
    verifyWindowStart: null,
    verifiedAt: null,
    ...overrides,
  };
}

function stubDb(row: StubRow | undefined, updates: unknown[]) {
  const selectChain: Record<string, unknown> = {};
  selectChain.from = () => selectChain;
  selectChain.where = () => selectChain;
  selectChain.limit = async () => (row ? [row] : []);
  const updateChain: Record<string, unknown> = {};
  updateChain.set = (v: unknown) => {
    updates.push(v);
    return updateChain;
  };
  updateChain.where = () =>
    Object.assign(Promise.resolve([]), { returning: async () => [{ id: row?.id }] });
  return {
    select: () => selectChain,
    update: () => updateChain,
    insert: () => ({ values: async () => [] }),
    execute: async () => [],
  };
}

describe("attemptVerification probe mode", () => {
  it("a probe mismatch writes nothing and spends no attempt", async () => {
    const updates: unknown[] = [];
    const db = stubDb(pendingRow({ verifyAttempts: 3, verifyWindowStart: new Date() }), updates);
    const outcome = await attemptVerification(
      db as never,
      "proj_test",
      "dom_test",
      async () => [],
      { probe: true }
    );
    expect(outcome.kind).toBe("mismatch");
    if (outcome.kind === "mismatch") expect(outcome.attemptsLeft).toBe(7);
    expect(updates).toEqual([]);
  });

  it("a probe past the rate limit still checks DNS instead of refusing", async () => {
    const updates: unknown[] = [];
    const oracle = vi.fn(async () => []);
    const db = stubDb(pendingRow({ verifyAttempts: 10, verifyWindowStart: new Date() }), updates);
    const outcome = await attemptVerification(db as never, "proj_test", "dom_test", oracle, {
      probe: true,
    });
    expect(oracle).toHaveBeenCalledOnce();
    expect(outcome.kind).toBe("mismatch");
    expect(updates).toEqual([]);
  });

  it("a real attempt past the rate limit refuses without touching DNS", async () => {
    const updates: unknown[] = [];
    const oracle = vi.fn(async () => []);
    const db = stubDb(pendingRow({ verifyAttempts: 10, verifyWindowStart: new Date() }), updates);
    const outcome = await attemptVerification(db as never, "proj_test", "dom_test", oracle);
    expect(oracle).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("rate_limited");
    expect(updates).toEqual([]);
  });

  it("a real mismatch records failure state and consumes one attempt", async () => {
    const updates: unknown[] = [];
    const db = stubDb(pendingRow({ verifyAttempts: 3, verifyWindowStart: new Date() }), updates);
    const outcome = await attemptVerification(db as never, "proj_test", "dom_test", async () => []);
    expect(outcome.kind).toBe("mismatch");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "failed", verifyAttempts: 4 });
  });

  it("a probe still flips a genuinely verified domain", async () => {
    const updates: unknown[] = [];
    const row = pendingRow();
    const value = expectedTxtValue(row.verificationToken as string);
    const db = stubDb(row, updates);
    const outcome = await attemptVerification(
      db as never,
      "proj_test",
      "dom_test",
      async () => [value],
      { probe: true }
    );
    expect(outcome.kind).toBe("verified");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "verified" });
  });
});
