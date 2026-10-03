import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  THEME_INIT_SCRIPT,
} from "../components/design-system";

describe("design system utilities", () => {
  it("formatRelativeTime handles null/undefined gracefully", () => {
    expect(formatRelativeTime(null)).toEqual({
      relative: "—",
      absolute: "Never",
    });
    expect(formatRelativeTime(undefined)).toEqual({
      relative: "—",
      absolute: "Never",
    });
  });

  it("formatRelativeTime formats recent timestamps as relative strings with UTC ISO tooltip", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const formatted = formatRelativeTime(tenMinAgo);
    expect(formatted.relative).toBe("10m ago");
    expect(formatted.absolute).toContain("UTC");
  });

  it("formatRelativeTime formats hours and days accurately", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    expect(formatRelativeTime(threeHoursAgo).relative).toBe("3h ago");

    const fiveDaysAgo = new Date(Date.now() - 5 * 86400 * 1000);
    expect(formatRelativeTime(fiveDaysAgo).relative).toBe("5d ago");
  });

  it("THEME_INIT_SCRIPT initializes data-theme before first paint without flash", () => {
    expect(THEME_INIT_SCRIPT).toContain("calder_theme");
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_INIT_SCRIPT).toContain("dataset.theme");
  });
});
