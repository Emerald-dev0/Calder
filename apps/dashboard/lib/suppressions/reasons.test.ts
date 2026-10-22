import { describe, expect, it } from "vitest";
import { SUPPRESSION_REASONS } from "@calder/db";
import {
  ADDABLE_REASONS,
  CANONICAL_REASONS,
  buildTabs,
  reasonMeta,
  reasonPillStatus,
  removalIsDangerous,
} from "./reasons";

/**
 * `suppressions.reason` is free text in the database, so every display helper
 * has to be total: an unknown legacy string must render as something readable,
 * never blank and never a crash.
 */
describe("CANONICAL_REASONS", () => {
  // The browser-safe restatement must not drift from the database contract.
  it("matches SUPPRESSION_REASONS from @calder/db exactly", () => {
    expect([...CANONICAL_REASONS]).toEqual([...SUPPRESSION_REASONS]);
  });

  it("stays in the same order, so filter tabs do not reshuffle", () => {
    expect([...CANONICAL_REASONS]).toEqual([...SUPPRESSION_REASONS]);
  });
});

describe("reasonMeta", () => {
  it("gives every canonical reason a reviewed label", () => {
    for (const reason of CANONICAL_REASONS) {
      const meta = reasonMeta(reason);
      expect(meta.label).not.toBe("");
      expect(meta.label).not.toBe("Unknown reason");
      expect(meta.hint.length).toBeGreaterThan(10);
    }
  });

  it("shows unsubscribe as 'Unsubscribed', not the raw value", () => {
    expect(reasonMeta("unsubscribe").label).toBe("Unsubscribed");
  });

  it("shows bounce as 'Bounced'", () => {
    expect(reasonMeta("bounce").label).toBe("Bounced");
  });

  it("marks unsubscribe as marketing-only and never org-wide", () => {
    const meta = reasonMeta("unsubscribe");
    expect(meta.marketingOnly).toBe(true);
    expect(meta.orgWide).toBe(false);
  });

  it("marks bounce and complaint as org-wide", () => {
    expect(reasonMeta("bounce").orgWide).toBe(true);
    expect(reasonMeta("complaint").orgWide).toBe(true);
  });

  it("keeps manual and import project-scoped", () => {
    expect(reasonMeta("manual").orgWide).toBe(false);
    expect(reasonMeta("import").orgWide).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(reasonMeta("BOUNCE").label).toBe("Bounced");
    expect(reasonMeta("Unsubscribe").label).toBe("Unsubscribed");
  });

  it("renders an unknown legacy reason readably instead of blank", () => {
    const meta = reasonMeta("abuse_report");
    expect(meta.label).toBe("Abuse report");
    expect(meta.tone).toBe("neutral");
    expect(meta.hint).toContain("does not recognise");
  });

  it("handles an empty reason", () => {
    expect(reasonMeta("").label).toBe("Unknown reason");
  });

  it("maps known legacy spellings onto their canonical meaning", () => {
    expect(reasonMeta("complained").label).toBe("Complaint");
    expect(reasonMeta("unsubscribed").label).toBe("Unsubscribed");
    expect(reasonMeta("hard_bounce").label).toBe("Bounced");
  });
});

describe("reasonPillStatus", () => {
  it("never returns a status the design system cannot render", () => {
    for (const reason of [...CANONICAL_REASONS, "weird_legacy", ""]) {
      expect(typeof reasonPillStatus(reason)).toBe("string");
      expect(reasonPillStatus(reason).length).toBeGreaterThan(0);
    }
  });

  it("uses the danger pill for bounces and complaints", () => {
    expect(reasonPillStatus("bounce")).toBe("bounce");
    expect(reasonPillStatus("complaint")).toBe("complaint");
  });
});

describe("buildTabs", () => {
  it("always starts with an All tab carrying the total", () => {
    const tabs = buildTabs([
      { reason: "bounce", count: 3 },
      { reason: "unsubscribe", count: 2 },
    ]);
    expect(tabs[0]).toEqual({ value: "all", label: "All", count: 5 });
  });

  it("includes one tab per canonical reason even at zero", () => {
    const tabs = buildTabs([]);
    expect(tabs).toHaveLength(CANONICAL_REASONS.length + 1);
    for (const reason of CANONICAL_REASONS) {
      expect(tabs.some((t) => t.value === reason)).toBe(true);
    }
    expect(tabs.every((t) => t.count === 0)).toBe(true);
  });

  it("surfaces legacy reasons so their rows are never invisible", () => {
    const tabs = buildTabs([{ reason: "abuse_report", count: 1 }]);
    const legacy = tabs.find((t) => t.value === "abuse_report");
    expect(legacy).toBeDefined();
    expect(legacy!.label).toBe("Abuse report");
    expect(tabs[0]!.count).toBe(1);
  });

  it("folds case variants of the same reason into one tab", () => {
    const tabs = buildTabs([
      { reason: "bounce", count: 1 },
      { reason: "Bounce", count: 2 },
    ]);
    const bounce = tabs.filter((t) => t.value === "bounce");
    expect(bounce).toHaveLength(1);
    expect(bounce[0]!.count).toBe(3);
  });
});

describe("removalIsDangerous", () => {
  it("flags bounce, complaint and their legacy spellings", () => {
    for (const r of ["bounce", "complaint", "hard_bounce", "abuse", "COMPLAINT"]) {
      expect(removalIsDangerous(r)).toBe(true);
    }
  });

  it("does not flag an unsubscribe or a manual block", () => {
    expect(removalIsDangerous("unsubscribe")).toBe(false);
    expect(removalIsDangerous("manual")).toBe(false);
  });
});

describe("ADDABLE_REASONS", () => {
  it("offers exactly the canonical set", () => {
    expect(ADDABLE_REASONS.map((r) => r.value)).toEqual([...CANONICAL_REASONS]);
  });

  it("every option has a label and a hint", () => {
    for (const r of ADDABLE_REASONS) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(10);
    }
  });
});
