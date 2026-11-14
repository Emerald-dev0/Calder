import { beforeEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = "NEXT_NOT_FOUND";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error(NOT_FOUND);
  }),
}));

vi.mock("./features", () => ({
  isDashboardFeatureAvailable: vi.fn(),
}));

const { notFound } = await import("next/navigation");
const { isDashboardFeatureAvailable } = await import("./features");
const { requireDashboardFeaturePage } = await import("./feature-gate");

describe("requireDashboardFeaturePage", () => {
  beforeEach(() => {
    vi.mocked(notFound).mockClear();
    vi.mocked(isDashboardFeatureAvailable).mockReset();
  });

  it("404s a page whose feature has not launched", () => {
    vi.mocked(isDashboardFeatureAvailable).mockReturnValue(false);
    expect(() => requireDashboardFeaturePage("inbound_email")).toThrow(NOT_FOUND);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("lets a launched feature through without touching the 404 boundary", () => {
    vi.mocked(isDashboardFeatureAvailable).mockReturnValue(true);
    expect(() => requireDashboardFeaturePage("inbound_email")).not.toThrow();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("asks the registry about the id it was given", () => {
    vi.mocked(isDashboardFeatureAvailable).mockReturnValue(true);
    requireDashboardFeaturePage("advanced_analytics");
    expect(isDashboardFeatureAvailable).toHaveBeenCalledWith("advanced_analytics");
  });
});
