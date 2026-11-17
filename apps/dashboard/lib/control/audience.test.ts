import { describe, it, expect } from "vitest";
import {
  AUDIENCE_OPTIONS,
  DEFAULT_AUDIENCE,
  audienceLabel,
  describeAudience,
  parseAudience,
  requiresUnverifiedConfirmation,
} from "./audience";

describe("parseAudience", () => {
  it("defaults to verified accounts", () => {
    expect(parseAudience(undefined)).toBe("verified");
    expect(parseAudience(null)).toBe("verified");
    expect(parseAudience("")).toBe("verified");
    expect(DEFAULT_AUDIENCE).toBe("verified");
  });

  it("accepts the wide audience only when asked for by name", () => {
    expect(parseAudience("everyone")).toBe("everyone");
  });

  it("treats anything unknown as the narrow audience, never the wide one", () => {
    for (const value of ["all", "EVERYONE", "unverified", " everyone"]) {
      expect(parseAudience(value)).toBe("verified");
    }
  });
});

describe("requiresUnverifiedConfirmation", () => {
  it("only gates the wide audience", () => {
    expect(requiresUnverifiedConfirmation("everyone")).toBe(true);
    expect(requiresUnverifiedConfirmation("verified")).toBe(false);
  });
});

describe("audience copy", () => {
  it("labels both options and offers no third", () => {
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual(["verified", "everyone"]);
    expect(audienceLabel("everyone")).toMatch(/every account/i);
    expect(audienceLabel("verified")).toMatch(/verified/i);
  });

  it("states the split in both directions", () => {
    expect(describeAudience("verified", 120, 150)).toContain("120 verified");
    expect(describeAudience("verified", 120, 150)).toContain("leaves 30 unverified");
    expect(describeAudience("everyone", 120, 150)).toContain("150 accounts");
    expect(describeAudience("everyone", 120, 150)).toContain("30 unverified");
  });

  it("says so when there is nothing being left out", () => {
    expect(describeAudience("verified", 80, 80)).toContain("none are unverified");
    expect(describeAudience("everyone", 80, 80)).toContain("every one of them is verified");
  });

  it("never reports a negative unverified count", () => {
    // A narrower total than verified (/verified/ is a subset here by definition)
    // must not produce "-6 unverified": the copy falls back to "all verified".
    const copy = describeAudience("everyone", 10, 4);
    expect(copy).not.toMatch(/-\d+ unverified/);
    expect(copy).toContain("every one of them is verified");
  });
});
