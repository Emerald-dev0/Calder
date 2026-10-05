import { describe, expect, it } from "vitest";
import { evaluateOrganizationAbusePolicy } from "./abuse-policy.js";

const policy = {
  minimumSends: 20,
  bounceRateThreshold: 0.1,
  complaintRateThreshold: 0.02,
};

describe("organization feedback auto-pause policy", () => {
  it("does not act without an adequate denominator", () => {
    const result = evaluateOrganizationAbusePolicy(
      { sentCount: 19, permanentBounceCount: 19, complaintCount: 19 },
      policy
    );
    expect(result.eligible).toBe(false);
    expect(result.pause).toBe(false);
  });

  it("pauses deterministically when either configured rate reaches its threshold", () => {
    const bounce = evaluateOrganizationAbusePolicy(
      { sentCount: 20, permanentBounceCount: 2, complaintCount: 0 },
      policy
    );
    expect(bounce.pause).toBe(true);
    expect(bounce.signals).toEqual(["permanent_bounce_rate"]);

    const complaint = evaluateOrganizationAbusePolicy(
      { sentCount: 50, permanentBounceCount: 0, complaintCount: 1 },
      policy
    );
    expect(complaint.pause).toBe(true);
    expect(complaint.signals).toEqual(["complaint_rate"]);
  });

  it("accepts below-threshold rates and allows an individual signal to be disabled", () => {
    expect(
      evaluateOrganizationAbusePolicy(
        { sentCount: 100, permanentBounceCount: 9, complaintCount: 1 },
        policy
      ).pause
    ).toBe(false);
    expect(
      evaluateOrganizationAbusePolicy(
        { sentCount: 100, permanentBounceCount: 100, complaintCount: 0 },
        { ...policy, bounceRateThreshold: 0 }
      ).pause
    ).toBe(false);
  });

  it("never divides by zero", () => {
    const result = evaluateOrganizationAbusePolicy(
      { sentCount: 0, permanentBounceCount: 0, complaintCount: 0 },
      policy
    );
    expect(result.bounceRate).toBe(0);
    expect(result.complaintRate).toBe(0);
    expect(result.pause).toBe(false);
  });
});
