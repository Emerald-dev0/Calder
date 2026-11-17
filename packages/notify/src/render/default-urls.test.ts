import { afterEach, describe, expect, it } from "vitest";
import { resetConfig } from "@calder/config";
import { defaultUrls, renderCompanyEmail } from "./render.js";

/**
 * Notification links are only useful if they land on the app.
 *
 * `defaultUrls()` used to read `CALDER_DASHBOARD_URL ?? app` — a variable no
 * deployment defines — so every company email derived its dashboard links from
 * the marketing origin (`https://calder.click/usage`), which 404s. These cases
 * pin the two origins apart and assert the rendered call-to-action follows.
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

describe("defaultUrls", () => {
  it("takes the dashboard base from DASHBOARD_URL, not from the marketing base", () => {
    setEnv({
      NODE_ENV: "test",
      CALDER_ENV: undefined,
      APP_URL: "https://calder.example.test",
      DASHBOARD_URL: "https://app.calder.example.test",
      NEXT_PUBLIC_APP_URL: undefined,
      CALDER_DASHBOARD_URL: undefined,
    });

    const urls = defaultUrls();

    expect(urls.app).toBe("https://calder.example.test");
    expect(urls.dashboard).toBe("https://app.calder.example.test");
    expect(urls.preferences).toBe("https://app.calder.example.test/settings/notifications");
    expect(urls.dashboard).not.toBe(urls.app);
  });

  it("uses the dashboard origin for in-app calls to action", () => {
    setEnv({
      NODE_ENV: "test",
      CALDER_ENV: undefined,
      APP_URL: "https://calder.example.test",
      DASHBOARD_URL: "https://app.calder.example.test",
      NEXT_PUBLIC_APP_URL: undefined,
      CALDER_DASHBOARD_URL: undefined,
    });

    const rendered = renderCompanyEmail({
      id: "usage.warning_80",
      data: { used: "800", limit: "1000", resetsOn: "2026-12-01", planName: "Starter" },
      urls: defaultUrls(),
    });

    expect(rendered.html).toContain("https://app.calder.example.test/usage");
    expect(rendered.html).not.toContain("https://calder.example.test/usage");
  });

  it("sends the plan comparison to the marketing pricing page", () => {
    setEnv({
      NODE_ENV: "test",
      CALDER_ENV: undefined,
      APP_URL: "https://calder.example.test",
      DASHBOARD_URL: "https://app.calder.example.test",
      NEXT_PUBLIC_APP_URL: undefined,
      CALDER_DASHBOARD_URL: undefined,
    });

    const rendered = renderCompanyEmail({
      id: "usage.exhausted_100",
      data: { used: "1000", limit: "1000", resetsOn: "2026-12-01", planName: "Starter" },
      urls: defaultUrls(),
    });

    expect(rendered.html).toContain("https://calder.example.test/pricing");
    expect(rendered.html).not.toContain("https://app.calder.example.test/pricing");
  });

  it("still honours explicit overrides (previews, tests)", () => {
    setEnv({ NODE_ENV: "test", CALDER_ENV: undefined });
    const urls = defaultUrls({
      app: "https://a.test",
      dashboard: "https://d.test",
    });
    expect(urls.app).toBe("https://a.test");
    expect(urls.dashboard).toBe("https://d.test");
    expect(urls.preferences).toBe("https://d.test/settings/notifications");
  });
});
