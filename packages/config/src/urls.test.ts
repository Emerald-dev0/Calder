import { afterEach, describe, expect, it } from "vitest";
import {
  assertConfiguredUrl,
  dashboardUrl,
  joinUrl,
  marketingUrl,
  publicUrl,
  resetConfig,
  UrlConfigError,
} from "./index.js";

/**
 * These tests exist because the failure they prevent is silent: a link built
 * from the wrong origin still renders, still validates as a URL, and only fails
 * when a customer clicks it. `/invite/<token>` shipped that way and 404'd for
 * every invited teammate.
 */

const ORIGINAL = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  resetConfig();
});

describe("joinUrl", () => {
  it("joins with exactly one slash", () => {
    expect(joinUrl("https://app.example.test", "settings")).toBe(
      "https://app.example.test/settings"
    );
    expect(joinUrl("https://app.example.test/", "/settings")).toBe(
      "https://app.example.test/settings"
    );
    expect(joinUrl("https://app.example.test///", "//settings")).toBe(
      "https://app.example.test/settings"
    );
  });

  it("returns the bare origin for an empty path", () => {
    expect(joinUrl("https://app.example.test/")).toBe("https://app.example.test");
  });

  it("keeps query strings and fragments intact", () => {
    expect(joinUrl("https://app.example.test", "/invite/tok?x=1#top")).toBe(
      "https://app.example.test/invite/tok?x=1#top"
    );
  });

  it("collapses a leading double slash so an id cannot become a host", () => {
    expect(joinUrl("https://app.example.test", "//evil.test/x")).toBe(
      "https://app.example.test/evil.test/x"
    );
  });
});

describe("assertConfiguredUrl", () => {
  it("stays quiet outside a hosted deployment", () => {
    expect(() =>
      assertConfiguredUrl("dashboard", "http://localhost:3001", {
        hosted: false,
        env: {},
      })
    ).not.toThrow();
  });

  it("refuses a localhost default when hosted and the variable is unset", () => {
    expect(() =>
      assertConfiguredUrl("dashboard", "http://localhost:3001", { hosted: true, env: {} })
    ).toThrow(UrlConfigError);
  });

  it("names the variable and the expected shape in the error", () => {
    try {
      assertConfiguredUrl("dashboard", "http://localhost:3001", { hosted: true, env: {} });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UrlConfigError);
      expect((err as Error).message).toContain("DASHBOARD_URL");
      expect((err as Error).message).toContain("app.calder.click");
    }
  });

  it("honours any explicit value, including a preview or localhost override", () => {
    expect(() =>
      assertConfiguredUrl("dashboard", "http://localhost:3001", {
        hosted: true,
        env: { DASHBOARD_URL: "http://localhost:3001" },
      })
    ).not.toThrow();
    expect(() =>
      assertConfiguredUrl("dashboard", "https://preview-abc.vercel.app", {
        hosted: true,
        env: {},
      })
    ).not.toThrow();
  });

  it("checks each host against its own variable", () => {
    expect(() =>
      assertConfiguredUrl("api", "http://localhost:3002", {
        hosted: true,
        env: { API_URL: "https://api.example.test" },
      })
    ).not.toThrow();
    expect(() =>
      assertConfiguredUrl("marketing", "http://localhost:3000", {
        hosted: true,
        env: { API_URL: "https://api.example.test" },
      })
    ).toThrow(UrlConfigError);
  });
});

describe("publicUrl", () => {
  it("builds the link without touching configuration when not hosted", () => {
    expect(publicUrl("dashboard", "https://dash.example.test", "/invite/abc")).toBe(
      "https://dash.example.test/invite/abc"
    );
  });
});

describe("host helpers", () => {
  it("sends dashboard links to DASHBOARD_URL and marketing links to APP_URL", () => {
    setEnv({
      NODE_ENV: "test",
      CALDER_ENV: undefined,
      APP_URL: "https://calder.test",
      DASHBOARD_URL: "https://app.calder.test",
      API_URL: "https://api.calder.test",
    });
    expect(dashboardUrl("/invite/tok")).toBe("https://app.calder.test/invite/tok");
    expect(marketingUrl("/pricing")).toBe("https://calder.test/pricing");
    // The regression: an invitation must never be built on the marketing host.
    expect(dashboardUrl("/invite/tok")).not.toContain("https://calder.test/");
  });

  it("does not share one origin between the two surfaces", () => {
    setEnv({
      NODE_ENV: "test",
      CALDER_ENV: undefined,
      APP_URL: "https://calder.test",
      DASHBOARD_URL: "https://app.calder.test",
    });
    expect(new URL(dashboardUrl()).origin).not.toBe(new URL(marketingUrl()).origin);
  });
});
