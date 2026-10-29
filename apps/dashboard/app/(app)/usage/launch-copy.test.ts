import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const data = vi.hoisted(() => ({ accepted: 12, metered: 8 }));
vi.mock("../../../lib/auth", () => ({
  getTenantContext: async () => ({
    memberships: [{ organization: { id: "org_fixture", name: "Fixture workspace" } }],
  }),
}));
vi.mock("@calder/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }),
    }),
  }),
  usageSummaries: {},
  orgUsageSnapshot: async () => ({
    tier: "beginner",
    acceptedLive: data.accepted,
    metered: data.metered,
    period: { start: new Date("2026-10-01"), end: new Date("2026-11-01") },
  }),
}));
import UsagePage from "./page";
beforeEach(() => {
  data.accepted = 12;
  data.metered = 8;
});
describe("launch Usage copy", () => {
  it("retains real counters/limits without offering billing or claiming inbox delivery", async () => {
    const html = renderToStaticMarkup(await UsagePage());
    expect(html).toContain("Provider-Accepted Sends");
    expect(html).toContain("12 / 5,000");
    expect(html).toContain("Billing is not available yet");
    expect(html).toContain("not an invoice");
    expect(html).not.toContain(">Delivered<");
    expect(html).not.toMatch(
      /Available Plans|Monthly Quotas|Compare Plans|Upgrade to keep sending|Confirmed remote MX/
    );
    if (process.env.UI_QA_DIR) {
      mkdirSync(process.env.UI_QA_DIR, { recursive: true });
      writeFileSync(join(process.env.UI_QA_DIR, "usage.html"), html);
    }
  });
  it("still shows exhausted quota rather than removing enforcement", async () => {
    data.accepted = 5000;
    const html = renderToStaticMarkup(await UsagePage());
    expect(html).toContain("Limit reached");
    expect(html).toContain("wait for the period reset".replace("wait", "Wait"));
    expect(html).not.toContain("Upgrade");
  });
});
