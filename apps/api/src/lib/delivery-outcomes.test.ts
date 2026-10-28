import { describe, expect, it } from "vitest";
import {
  OUTCOME_FAIL_RATIO,
  OUTCOME_MIN_SAMPLE,
  classifyDeliveryOutcomes,
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
