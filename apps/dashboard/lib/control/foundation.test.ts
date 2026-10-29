import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const state = vi.hoisted(() => ({
  path: "/control/observability/metrics",
  guard: vi.fn(),
  outcomes: vi.fn(),
  queue: vi.fn(),
  hooks: vi.fn(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/lib/control/guard", () => ({ requireSection: state.guard }));
vi.mock("@/lib/control/queries", () => ({
  deliveryOutcomeSummary: state.outcomes,
  queueDerived: state.queue,
  webhookStats: state.hooks,
}));
vi.mock("@/lib/control/environment", () => import("./environment"));
vi.mock("@/lib/control/format", () => import("./format"));
vi.mock("@/control/_components/ui", () => import("../../app/control/_components/ui"));
import MetricsPage from "../../app/control/observability/metrics/page";
import { SidebarShell } from "../../app/control/_components/sidebar-shell";
import { MobileNav } from "../../app/control/_components/nav";
const groups = [
  { heading: "Overview", items: [{ label: "Command Center", href: "/control", exact: true }] },
  {
    heading: "Observability",
    items: [
      { label: "Metrics", href: "/control/observability/metrics" },
      { label: "Alerts", href: "/control/observability/alerts" },
    ],
  },
  {
    heading: "Operations",
    items: [{ label: "Maintenance", href: "/control/operations/maintenance" }],
  },
];
beforeEach(() => {
  vi.clearAllMocks();
  state.guard.mockResolvedValue({ role: "founder" });
  state.outcomes.mockResolvedValue({
    started: 20,
    sent: 7,
    delivered: 6,
    deliveryRate: 75,
    failed: 1,
    bounced: 1,
    complained: 0,
    suppressed: 2,
  });
  state.queue.mockResolvedValue({ inFlight: 3, oldestAgeMinutes: 18, failedRecent: 2 });
  state.hooks.mockResolvedValue({ endpoints: 2, pending: 1, failed: 2, exhausted: 3 });
});
it("renders the actual scoped founder shell and one active navigation link", () => {
  const html = renderToStaticMarkup(
    createElement(SidebarShell, {
      groups,
      name: "QA Operator",
      email: "qa@example.invalid",
      roleLabel: "Support Admin",
      children: "Fixture",
    })
  );
  expect(html).toContain('class="cp cp-shell"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain("Find a workspace");
  expect(html).not.toContain("Support Admin · Owner");
});
it("renders durable metrics with their actual scopes and no fabricated percentiles", async () => {
  const page = await MetricsPage({});
  const html = renderToStaticMarkup(page);
  expect(state.guard).toHaveBeenCalledWith("observability");
  expect(state.outcomes).toHaveBeenCalledWith(30, "live");
  expect(html).toContain("18 min");
  expect(html).toContain("not BullMQ counters");
  expect(html).toContain("75.0%");
  expect(html).toContain("not inbox delivery");
  expect(html).toContain("Not yet measured here");
  if (process.env.UI_QA_DIR) {
    mkdirSync(process.env.UI_QA_DIR, { recursive: true });
    const html = renderToStaticMarkup(
      createElement(SidebarShell, {
        groups,
        name: "QA Operator",
        email: "qa@example.invalid",
        roleLabel: "Founder",
        children: createElement(
          "div",
          null,
          createElement(MobileNav, { groups }),
          createElement(
            "div",
            { className: "cp-topbar" },
            "Calder / Control Plane · LOCAL FIXTURE"
          ),
          createElement("main", { className: "cp-content" }, page)
        ),
      })
    );
    writeFileSync(join(process.env.UI_QA_DIR, "founder.html"), html);
  }
});
it("does not fetch platform data if the section guard denies access", async () => {
  state.guard.mockRejectedValueOnce(new Error("Access denied"));
  await expect(MetricsPage({})).rejects.toThrow("Access denied");
  expect(state.outcomes).not.toHaveBeenCalled();
  expect(state.queue).not.toHaveBeenCalled();
});
it("shows unknown rates and empty queues honestly", async () => {
  state.outcomes.mockResolvedValue({
    started: 0,
    sent: 0,
    delivered: 0,
    deliveryRate: null,
    failed: 0,
    bounced: 0,
    complained: 0,
    suppressed: 0,
  });
  state.queue.mockResolvedValue({ inFlight: 0, oldestAgeMinutes: null, failedRecent: 0 });
  const html = renderToStaticMarkup(await MetricsPage({}));
  expect(html).toContain("No waiting messages");
  expect(html).toContain("—");
  expect(html).not.toContain("NaN");
});

it("does not expose raw errors or represent a failed query as zero", async () => {
  const { default: ControlError } = await import("../../app/control/error");
  const html = renderToStaticMarkup(
    createElement(ControlError, {
      error: new Error("SECRET_DATABASE_CONNECTION"),
      reset: () => {},
    })
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("unavailable, not zero");
  expect(html).not.toContain("SECRET_DATABASE_CONNECTION");
});

it("passes explicit test/all selection and defaults invalid environment state to live", async () => {
  await MetricsPage({ searchParams: Promise.resolve({ env: "test" }) });
  expect(state.outcomes).toHaveBeenLastCalledWith(30, "test");
  expect(state.queue).toHaveBeenLastCalledWith("test");
  await MetricsPage({ searchParams: Promise.resolve({ env: "all" }) });
  expect(state.outcomes).toHaveBeenLastCalledWith(30, "all");
  await MetricsPage({ searchParams: Promise.resolve({ env: "not-an-environment" }) });
  expect(state.outcomes).toHaveBeenLastCalledWith(30, "live");
});
