import { describe, expect, it, vi } from "vitest";
import { isForeignKeyViolation, recordDrainEvent } from "./drain.js";

/**
 * Phase 0, M0.2: a parent email deleted mid-flight (org cascade, retention,
 * parallel-suite cleanup) must not abort the drain batch. Runs without a
 * database: the db client is stubbed at the insert boundary.
 */
describe("recordDrainEvent", () => {
  const values = {
    id: "ev_test",
    emailId: "em_gone",
    projectId: "proj_test",
    type: "sent" as const,
    data: { provider: "mock" },
  };

  it("returns true when the insert succeeds", async () => {
    const db = { insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }) };
    await expect(recordDrainEvent(db as never, values)).resolves.toBe(true);
  });

  it("swallows Postgres 23503 and returns false", async () => {
    const fk = Object.assign(new Error("violates foreign key"), { code: "23503" });
    const db = {
      insert: () => ({
        values: vi.fn().mockRejectedValue(fk),
      }),
    };
    await expect(recordDrainEvent(db as never, values)).resolves.toBe(false);
  });

  it("rethrows non-FK errors", async () => {
    const boom = new Error("connection reset");
    const db = { insert: () => ({ values: vi.fn().mockRejectedValue(boom) }) };
    await expect(recordDrainEvent(db as never, values)).rejects.toThrow("connection reset");
  });
});

describe("isForeignKeyViolation", () => {
  it("matches Postgres 23503 only", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(new Error("x"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});
