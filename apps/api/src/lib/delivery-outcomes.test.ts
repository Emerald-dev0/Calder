import { describe, expect, it } from "vitest";
import {
  OUTCOME_FAIL_RATIO,
  OUTCOME_MIN_SAMPLE,
  classifyDeliveryOutcomes,
  classifyLastFailure,
  describeDeliveryFailure,
  readinessCheck,
} from "./delivery-outcomes";

/**
 * The verdict that was missing on the day it mattered: 9 failed, 47 stuck and
 * 1 delivered, while `/ready` reported the provider as `ok` because two env
 * vars were non-empty.
 */
describe("classifyDeliveryOutcomes", () => {
  it("calls a majority-failure window degraded, and says the numbers", () => {
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 1, failed: 9 });
    expect(verdict.state).toBe("degraded");
    expect(verdict.detail).toContain("9 of 10 messages");
    expect(verdict.detail).toContain("90%");
    expect(verdict.detail).toContain("not being delivered");
  });

  it("stays quiet for a healthy window", () => {
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 50, failed: 1 });
    expect(verdict.state).toBe("ok");
    expect(verdict.detail).toContain("50 of 51");
  });

  it("does not page on a small sample", () => {
    // One bounce out of two is not evidence of an outage, and an alert that
    // fires on it teaches an operator to ignore alerts.
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 1, failed: 1 });
    expect(verdict.state).toBe("idle");
    expect(verdict.detail).toContain("too few to judge");
  });

  it("reports an empty window as empty, not as healthy", () => {
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 0, failed: 0 });
    expect(verdict.state).toBe("idle");
    expect(verdict.detail).toContain("no messages finished");
  });

  it("treats the threshold as inclusive, and the sample floor as the gate", () => {
    // At the floor with exactly half failing: the ratio is met, so it fires.
    const exactlyHalf = classifyDeliveryOutcomes({
      windowMinutes: 60,
      accepted: OUTCOME_MIN_SAMPLE / 2,
      failed: OUTCOME_MIN_SAMPLE / 2,
    });
    expect(exactlyHalf.state).toBe("degraded");

    // One message short of the floor, same ratio: silence.
    const underFloor = classifyDeliveryOutcomes({
      windowMinutes: 60,
      accepted: 1,
      failed: OUTCOME_MIN_SAMPLE - 2,
    });
    expect(underFloor.state).toBe("idle");
  });

  it("names the window it measured, because 'recently' is not a measurement", () => {
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 15, accepted: 0, failed: 0 });
    expect(verdict.detail).toContain("15 minutes");
  });

  it("has a threshold low enough to catch a total outage early", () => {
    // A rule that only fires at 90% failure would have reported today's
    // 90%-failure window as almost fine for an hour.
    expect(OUTCOME_FAIL_RATIO).toBeLessThanOrEqual(0.5);
    expect(OUTCOME_MIN_SAMPLE).toBeGreaterThan(1);
  });
});

/**
 * "Too few finished messages to judge" is not health.
 *
 * `/ready` rendered `idle` as `ok`, so during the outage — one failure and one
 * delivery inside the hour — the check reported success on every request. The
 * absent measurement is now labelled as absent.
 */
describe("readinessCheck", () => {
  it("renders an idle window as skipped, never ok", () => {
    const verdict = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 1, failed: 1 });
    expect(verdict.state).toBe("idle");
    expect(readinessCheck(verdict).state).toBe("skipped");
  });

  it("passes through a measured verdict unchanged", () => {
    const degraded = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 1, failed: 9 });
    expect(readinessCheck(degraded).state).toBe("degraded");
    const ok = classifyDeliveryOutcomes({ windowMinutes: 60, accepted: 9, failed: 1 });
    expect(readinessCheck(ok).state).toBe("ok");
  });
});

/**
 * A ratio needs five finished messages to say anything; a single failure is
 * what an operator is actually looking for, and it has a reason attached.
 */
describe("classifyLastFailure", () => {
  it("treats platform-wide codes as degraded, with or without the drain prefix", () => {
    expect(classifyLastFailure("Exhausted: provider_error")).toBe("degraded");
    expect(classifyLastFailure("Exhausted after 5 attempts: Throttling")).toBe("degraded");
    expect(classifyLastFailure("AccessDeniedException")).toBe("degraded");
    expect(classifyLastFailure("MailFromDomainNotVerifiedException")).toBe("degraded");
    expect(classifyLastFailure("Sending is currently unavailable for this organization.")).toBe(
      "degraded"
    );
  });

  it("does not cry wolf for one message that could not be delivered", () => {
    expect(classifyLastFailure("Exhausted: InvalidRecipient")).toBe("ok");
    expect(classifyLastFailure("suppressed")).toBe("ok");
  });
});

describe("describeDeliveryFailure", () => {
  it("prints the reason and when it happened", () => {
    expect(describeDeliveryFailure({ code: "Exhausted: provider_error", minutesAgo: 4 })).toBe(
      "last failure: Exhausted: provider_error (4 min ago)"
    );
    expect(describeDeliveryFailure({ code: "provider_error", minutesAgo: 0 })).toContain(
      "less than a minute ago"
    );
  });
});
