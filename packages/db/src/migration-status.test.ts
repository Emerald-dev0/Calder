import { describe, expect, it } from "vitest";
import { diffMigrations, hashMigrationFile } from "./migration-status.js";

describe("diffMigrations", () => {
  const entries = [
    { tag: "0000_init", when: 1000, hash: "aaa" },
    { tag: "0017_case", when: 2000, hash: "bbb" },
    { tag: "0022_auth_hardening", when: 3000, hash: "ccc" },
  ];

  it("reports nothing on a fully migrated database", () => {
    expect(diffMigrations(entries, new Set(["aaa", "bbb", "ccc"]), 3000)).toEqual({
      pending: [],
      regenerated: [],
    });
  });

  it("reports unapplied content as pending", () => {
    expect(diffMigrations(entries, new Set(["aaa", "bbb"]), 2000)).toEqual({
      pending: ["0022_auth_hardening"],
      regenerated: [],
    });
  });

  it("flags applied content with a bumped timestamp as regenerated", () => {
    // The production outage shape: 0017's content was applied long ago, but
    // its journal `when` was regenerated past the newest applied migration,
    // so drizzle re-ran it and crashed on existing objects.
    expect(diffMigrations(entries, new Set(["aaa", "bbb", "ccc"]), 1500)).toEqual({
      pending: [],
      regenerated: ["0017_case", "0022_auth_hardening"],
    });
  });

  it("treats a fresh database (no applied info) as fully pending", () => {
    expect(diffMigrations(entries, new Set(), null)).toEqual({
      pending: ["0000_init", "0017_case", "0022_auth_hardening"],
      regenerated: [],
    });
  });
});

describe("hashMigrationFile", () => {
  it("is deterministic and content-sensitive", () => {
    expect(hashMigrationFile("abc")).toBe(hashMigrationFile("abc"));
    expect(hashMigrationFile("abc")).not.toBe(hashMigrationFile("abd"));
    expect(hashMigrationFile("abc")).toHaveLength(64);
  });
});
