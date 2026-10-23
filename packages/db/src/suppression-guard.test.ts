import { describe, expect, it } from "vitest";
import {
  MARKETING_ONLY_SUPPRESSION_REASONS,
  ORG_WIDE_SUPPRESSION_REASONS,
  blocksStream,
  describeBlock,
  isMarketingOnlyReason,
  isOrgWideReason,
  type BlockingSuppression,
} from "./suppression-guard.js";

/**
 * The suppression policy is the difference between a customer's password reset
 * arriving and it silently not arriving, so it is tested as a decision table
 * rather than a single example.
 */
describe("blocksStream — decision table", () => {
  it("an unsubscribe blocks broadcast mail only", () => {
    expect(blocksStream("unsubscribe", "marketing")).toBe(true);
    expect(blocksStream("unsubscribe", "transactional")).toBe(false);
  });

  it("a bounce blocks both streams", () => {
    expect(blocksStream("bounce", "transactional")).toBe(true);
    expect(blocksStream("bounce", "marketing")).toBe(true);
  });

  it("a complaint blocks both streams", () => {
    expect(blocksStream("complaint", "transactional")).toBe(true);
    expect(blocksStream("complaint", "marketing")).toBe(true);
  });

  it("a manual block blocks both streams", () => {
    expect(blocksStream("manual", "transactional")).toBe(true);
    expect(blocksStream("manual", "marketing")).toBe(true);
  });

  it("an imported suppression blocks both streams", () => {
    expect(blocksStream("import", "transactional")).toBe(true);
    expect(blocksStream("import", "marketing")).toBe(true);
  });

  it("a repeated soft bounce blocks both streams", () => {
    expect(blocksStream("soft_bounce_repeated", "transactional")).toBe(true);
    expect(blocksStream("soft_bounce_repeated", "marketing")).toBe(true);
  });

  it("an unknown legacy reason fails closed", () => {
    // A row exists, so it meant something to whoever wrote it. Treating an
    // unrecognised string as "no block" would silently start mailing people
    // who were deliberately suppressed.
    expect(blocksStream("abuse_report", "transactional")).toBe(true);
    expect(blocksStream("abuse_report", "marketing")).toBe(true);
    expect(blocksStream("", "transactional")).toBe(true);
  });

  it("stream values outside the enum still resolve deterministically", () => {
    expect(blocksStream("unsubscribe", "marketing")).toBe(true);
    expect(blocksStream("unsubscribe", "transactional")).toBe(false);
  });
});

describe("scope predicates", () => {
  it("only bounce and complaint are organization-wide", () => {
    expect([...ORG_WIDE_SUPPRESSION_REASONS]).toEqual(["bounce", "complaint"]);
    for (const reason of ["bounce", "complaint"]) expect(isOrgWideReason(reason)).toBe(true);
    for (const reason of ["unsubscribe", "manual", "import", "soft_bounce_repeated", "weird"]) {
      expect(isOrgWideReason(reason)).toBe(false);
    }
  });

  it("only unsubscribe is marketing-only", () => {
    expect([...MARKETING_ONLY_SUPPRESSION_REASONS]).toEqual(["unsubscribe"]);
    expect(isMarketingOnlyReason("unsubscribe")).toBe(true);
    expect(isMarketingOnlyReason("manual")).toBe(false);
    expect(isMarketingOnlyReason("bounce")).toBe(false);
  });
});

describe("describeBlock", () => {
  const base: BlockingSuppression = {
    id: "sup_1",
    email: "a@b.test",
    reason: "bounce",
    projectId: "proj_a",
    organizationId: "org_1",
    crossProject: false,
    blocksAllStreams: true,
  };

  it("names the project when the row is local", () => {
    expect(describeBlock(base)).toContain("this project");
  });

  it("names the workspace when the row came from another project", () => {
    expect(describeBlock({ ...base, crossProject: true })).toContain(
      "another project in this workspace"
    );
  });

  it("says 'broadcast mail' only for a marketing-only block", () => {
    expect(describeBlock({ ...base, blocksAllStreams: false })).toContain("for broadcast mail");
    expect(describeBlock(base)).not.toContain("broadcast mail");
  });
});
