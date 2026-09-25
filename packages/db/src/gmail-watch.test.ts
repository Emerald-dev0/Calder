import { describe, it, expect } from "vitest";
import {
  assessGmailVelocity,
  GmailWatchError,
  DEFAULT_GMAIL_WATCH,
  type GmailWatchThresholds,
} from "./gmail-watch.js";

const T: GmailWatchThresholds = {
  warnPerHour: 40,
  limitPerHour: 120,
  suspendPerHour: 600,
  graduateDailyAvg: 100,
  dailyCap: 400,
};

describe("assessGmailVelocity — M2.5 policy table", () => {
  it("ordinary usage passes", () => {
    expect(assessGmailVelocity({ lastHour: 3, today: 10, dailyAvg7d: 4 }, T)).toEqual({
      level: "ok",
    });
  });

  it("hourly warn fires once warn/hour is reached", () => {
    const v = assessGmailVelocity({ lastHour: 41, today: 80, dailyAvg7d: 20 }, T);
    expect(v.level).toBe("warn");
  });

  it("warn boundary is inclusive", () => {
    expect(assessGmailVelocity({ lastHour: 40, today: 80, dailyAvg7d: 20 }, T).level).toBe("warn");
    expect(assessGmailVelocity({ lastHour: 39, today: 80, dailyAvg7d: 20 }, T).level).toBe("ok");
  });

  it("hourly limit hard-stops the leg transiently", () => {
    expect(assessGmailVelocity({ lastHour: 130, today: 500, dailyAvg7d: 90 }, T).level).toBe(
      "limit"
    );
  });

  it("sustained outgrowth + cap-reached-today limits even below hourly lines", () => {
    const v = assessGmailVelocity(
      { lastHour: 30, today: 400, dailyAvg7d: 150 },
      T
    );
    expect(v.level).toBe("limit");
  });

  it("sustained outgrowth alone (cap not reached yet) does NOT limit", () => {
    expect(assessGmailVelocity({ lastHour: 30, today: 100, dailyAvg7d: 150 }, T).level).toBe("ok");
  });

  it("automation-burst velocity suspends", () => {
    const v = assessGmailVelocity({ lastHour: 650, today: 900, dailyAvg7d: 200 }, T);
    expect(v.level).toBe("suspend");
  });

  it("suspend outranks limit; limit outranks warn", () => {
    expect(assessGmailVelocity({ lastHour: 700, today: 900, dailyAvg7d: 10 }, T).level).toBe(
      "suspend"
    );
    expect(assessGmailVelocity({ lastHour: 121, today: 200, dailyAvg7d: 10 }, T).level).toBe(
      "limit"
    );
  });
});

describe("GmailWatchError", () => {
  it("limit is a transient 429 (retryable, failover-friendly)", () => {
    const err = new GmailWatchError({ level: "limit", lastHour: 130 });
    expect(err.code).toBe("gmail_velocity_limit");
    expect(err.transient).toBe(true);
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/120|130/);
  });

  it("suspend is a permanent 403 for the transport", () => {
    const err = new GmailWatchError({ level: "suspend", lastHour: 700 });
    expect(err.code).toBe("gmail_suspended");
    expect(err.transient).toBe(false);
    expect(err.statusCode).toBe(403);
    expect(err.message).toMatch(/suspended/i);
  });
});

describe("DEFAULT_GMAIL_WATCH thresholds", () => {
  it("hierarchy holds: warn < limit < suspend", () => {
    expect(DEFAULT_GMAIL_WATCH.warnPerHour).toBeLessThan(DEFAULT_GMAIL_WATCH.limitPerHour);
    expect(DEFAULT_GMAIL_WATCH.limitPerHour).toBeLessThan(DEFAULT_GMAIL_WATCH.suspendPerHour);
  });
});
