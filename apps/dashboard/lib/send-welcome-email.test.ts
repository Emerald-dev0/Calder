import { describe, it, expect } from "vitest";
import { WELCOME_WINDOW_DAYS, isWithinWelcomeWindow } from "./send-welcome-email";

const now = new Date("2026-03-10T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("isWithinWelcomeWindow", () => {
  it("welcomes an account created minutes ago", () => {
    expect(isWithinWelcomeWindow(new Date(now.getTime() - 60_000), now)).toBe(true);
  });

  it("welcomes someone who signed up and came back inside the window", () => {
    expect(isWithinWelcomeWindow(daysAgo(WELCOME_WINDOW_DAYS - 1), now)).toBe(true);
  });

  it("includes the boundary day", () => {
    expect(isWithinWelcomeWindow(daysAgo(WELCOME_WINDOW_DAYS), now)).toBe(true);
  });

  it("does not mail a long-standing account", () => {
    // The reason this exists: without it, adding OAuth to the welcome paths
    // would have mailed "Welcome aboard" to every existing OAuth user at their
    // next sign-in, months after they joined.
    expect(isWithinWelcomeWindow(daysAgo(8), now)).toBe(false);
    expect(isWithinWelcomeWindow(daysAgo(365), now)).toBe(false);
  });

  it("treats an unknown date as new rather than silently withholding a welcome", () => {
    expect(isWithinWelcomeWindow(null, now)).toBe(true);
    expect(isWithinWelcomeWindow(undefined, now)).toBe(true);
    expect(isWithinWelcomeWindow("not a date", now)).toBe(true);
  });

  it("accepts the string form a driver may return", () => {
    expect(isWithinWelcomeWindow(daysAgo(2).toISOString(), now)).toBe(true);
    expect(isWithinWelcomeWindow(daysAgo(30).toISOString(), now)).toBe(false);
  });
});
