import { describe, it, expect } from "vitest";
import {
  slugify,
  isValidSlug,
  isValidUsername,
  USE_CASES,
  ONBOARDING_PHASES,
  ONBOARDING_TOTAL_STEPS,
  PROFILE_ROLES,
  SENDING_MODE_OPTIONS,
  getPhaseProgress,
  resolveInitialOnboardingStep,
} from "./onboarding";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });
  it("strips special chars and edge hyphens", () => {
    expect(slugify(" Hello, World! ")).toBe("hello-world");
  });
  it("caps at 100 chars", () => {
    expect(slugify("a".repeat(150)).length).toBeLessThanOrEqual(100);
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase alphanumeric + hyphens", () => {
    expect(isValidSlug("acme-prod")).toBe(true);
  });
  it("rejects uppercase, spaces, empty, edge hyphens", () => {
    expect(isValidSlug("Acme Prod")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
  });
});

describe("isValidUsername", () => {
  it("accepts github-style handles", () => {
    expect(isValidUsername("ada-99")).toBe(true);
  });
  it("rejects uppercase, spaces, edge hyphens, empties", () => {
    expect(isValidUsername("Ada")).toBe(false);
    expect(isValidUsername("ada 99")).toBe(false);
    expect(isValidUsername("-ada")).toBe(false);
    expect(isValidUsername("")).toBe(false);
  });
});

describe("USE_CASES", () => {
  it("warns marketers off explicitly", () => {
    expect(USE_CASES.some((u) => u.toLowerCase().includes("transactional-only"))).toBe(true);
  });
});

describe("onboarding phases & steps", () => {
  it("defines 3 phases spanning all 6 steps", () => {
    expect(ONBOARDING_PHASES).toHaveLength(3);
    const allSteps = ONBOARDING_PHASES.flatMap((p) => p.steps);
    expect(allSteps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ONBOARDING_TOTAL_STEPS).toBe(6);
  });

  it("computes phase progress accurately across steps 1..6", () => {
    const s1 = getPhaseProgress(1);
    expect(s1.map((p) => [p.status, p.fillPercent])).toEqual([
      ["active", 33],
      ["upcoming", 0],
      ["upcoming", 0],
    ]);

    const s2 = getPhaseProgress(2);
    expect(s2.map((p) => [p.status, p.fillPercent])).toEqual([
      ["active", 67],
      ["upcoming", 0],
      ["upcoming", 0],
    ]);

    const s4 = getPhaseProgress(4);
    expect(s4.map((p) => [p.status, p.fillPercent])).toEqual([
      ["complete", 100],
      ["active", 100],
      ["upcoming", 0],
    ]);

    const s5 = getPhaseProgress(5);
    expect(s5.map((p) => [p.status, p.fillPercent])).toEqual([
      ["complete", 100],
      ["complete", 100],
      ["active", 50],
    ]);

    const s6 = getPhaseProgress(6);
    expect(s6.map((p) => [p.status, p.fillPercent])).toEqual([
      ["complete", 100],
      ["complete", 100],
      ["active", 100],
    ]);
  });

  it("exposes the 7 profile roles and 3 sending setup modes", () => {
    expect(PROFILE_ROLES).toHaveLength(7);
    expect(SENDING_MODE_OPTIONS.map((m) => m.id)).toEqual(["shared", "gmail", "domain", "later"]);
  });

  it("resumes at the exact persisted step and guards missing prerequisites", () => {
    expect(
      resolveInitialOnboardingStep({
        onboardingState: "not_started",
        hasUsername: false,
        hasOrg: false,
        hasProject: false,
      })
    ).toBe(1);

    expect(
      resolveInitialOnboardingStep({
        onboardingState: "step_2",
        hasUsername: false,
        hasOrg: false,
        hasProject: false,
      })
    ).toBe(2);

    expect(
      resolveInitialOnboardingStep({
        onboardingState: "step_5",
        hasUsername: true,
        hasOrg: true,
        hasProject: true,
      })
    ).toBe(5);

    // Falls back to step 3 if step_5 was saved but org/project are missing
    expect(
      resolveInitialOnboardingStep({
        onboardingState: "step_5",
        hasUsername: true,
        hasOrg: false,
        hasProject: false,
      })
    ).toBe(3);

    // Gmail callback notice lands on step 4 when org & project exist
    expect(
      resolveInitialOnboardingStep({
        onboardingState: "step_3",
        hasUsername: true,
        hasOrg: true,
        hasProject: true,
        notice: "gmail-ok",
      })
    ).toBe(4);
  });
});
