import { describe, it, expect } from "vitest";
import {
  AUDIENCE_OPTIONS,
  DEFAULT_AUDIENCE,
  audienceLabel,
  audienceWhere,
  describeAudience,
  describeSelectedAudience,
  parseAudience,
  parseSelectedAddresses,
  requiresUnverifiedConfirmation,
} from "./audience";

describe("parseAudience", () => {
  it("defaults to verified accounts", () => {
    expect(parseAudience(undefined)).toBe("verified");
    expect(parseAudience(null)).toBe("verified");
    expect(parseAudience("")).toBe("verified");
    expect(DEFAULT_AUDIENCE).toBe("verified");
  });

  it("accepts the wider audiences only when asked for by name", () => {
    expect(parseAudience("everyone")).toBe("everyone");
    expect(parseAudience("selected")).toBe("selected");
    expect(parseAudience(" selected ")).toBe("selected");
  });

  it("normalises surrounding whitespace rather than widening on a near-miss", () => {
    // " everyone " is the same choice with a space around it; "all" is not a
    // choice at all. Only the second falls back.
    expect(parseAudience(" everyone ")).toBe("everyone");
  });

  it("treats anything unknown as the narrow audience, never the wide one", () => {
    for (const value of ["all", "EVERYONE", "unverified", "everybody", "people"]) {
      expect(parseAudience(value)).toBe("verified");
    }
  });
});

describe("parseSelectedAddresses", () => {
  it("splits a pasted column on commas, semicolons and whitespace", () => {
    const { addresses } = parseSelectedAddresses(
      "Ada@Example.com, grace@example.com\nlin@x.io; jo@x.io"
    );
    expect(addresses).toEqual(["ada@example.com", "grace@example.com", "lin@x.io", "jo@x.io"]);
  });

  it("collapses duplicates that differ only in case", () => {
    expect(parseSelectedAddresses("ADA@x.io, ada@x.io, Ada@X.io").addresses).toEqual(["ada@x.io"]);
  });

  it("keeps malformed entries so they can be named in a refusal", () => {
    // Dropping them would turn "2 of 3 matched" into a lie by omission.
    expect(parseSelectedAddresses("ada@x.io, not-an-address").addresses).toEqual([
      "ada@x.io",
      "not-an-address",
    ]);
  });

  it("caps the list and says it truncated rather than silently cutting", () => {
    const many = Array.from({ length: 501 }, (_, i) => `u${i}@x.io`).join(",");
    const parsed = parseSelectedAddresses(many);
    expect(parsed.addresses).toHaveLength(500);
    expect(parsed.truncated).toBe(true);
  });

  it("returns nothing for an empty or absent field", () => {
    expect(parseSelectedAddresses("").addresses).toEqual([]);
    expect(parseSelectedAddresses(undefined).addresses).toEqual([]);
  });
});

describe("requiresUnverifiedConfirmation", () => {
  it("is about the addresses in the run, not the menu item that produced them", () => {
    expect(requiresUnverifiedConfirmation(0)).toBe(false);
    expect(requiresUnverifiedConfirmation(1)).toBe(true);
    expect(requiresUnverifiedConfirmation(37)).toBe(true);
  });
});

describe("audience copy", () => {
  it("offers exactly three audiences and labels each", () => {
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual(["verified", "everyone", "selected"]);
    expect(audienceLabel("everyone")).toMatch(/every account/i);
    expect(audienceLabel("verified")).toMatch(/verified/i);
    expect(audienceLabel("selected")).toMatch(/specific people/i);
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

  it("names what a hand-picked list leaves out", () => {
    expect(describeSelectedAudience(4, 0, 0)).toBe(
      "Mails 4 accounts. Every one of them has confirmed their address."
    );
    expect(describeSelectedAudience(4, 2, 1)).toContain("2 of them never confirmed");
    expect(describeSelectedAudience(4, 2, 1)).toContain("1 address belongs to no account");
    expect(describeSelectedAudience(1, 0, 2)).toContain("2 addresses belong to no account");
  });
});

describe("audienceWhere", () => {
  it("returns no filter only for the deliberate wide scope", () => {
    expect(audienceWhere("everyone")).toBeUndefined();
    expect(audienceWhere("verified")).toBeDefined();
  });

  it("never widens an empty selection into 'everybody'", () => {
    // The one failure that cannot be undone. `selected` with no names must be a
    // predicate that matches nobody, not an absent filter.
    const empty = audienceWhere("selected", []);
    expect(empty).toBeDefined();
    expect(audienceWhere("selected", ["usr_1"])).toBeDefined();
    expect(empty).not.toEqual(audienceWhere("selected", ["usr_1"]));
  });
});
