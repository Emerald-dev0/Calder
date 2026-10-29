import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const state = vi.hoisted(() => ({ role: "founder", empty: false, userRows: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/control/observability/incidents",
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: vi.fn(),
  notFound: () => {
    throw Error("Not found");
  },
}));
vi.mock("@/lib/control/guard", () => ({
  requireSection: async () => ({ role: state.role, user: { userId: "qa_operator" } }),
}));
vi.mock("@/lib/control/format", () => import("./format"));
vi.mock("@/lib/control/range", () => import("./range"));
vi.mock("@/lib/control/incident-policy", () => import("./incident-policy"));
vi.mock("@/lib/control/activation", () => ({
  organizationActivation: async () => ({
    organizations: 12,
    verified: 10,
    projects: 8,
    senders: 6,
    activated: 4,
  }),
}));
vi.mock("@/lib/control/incidents", () => ({
  incidentRows: async () => ({
    rows: [
      {
        id: "inc_fixture",
        title: "Investigating delayed deliveries",
        status: "investigating",
        severity: "sev2",
        updatedAt: new Date("2026-10-29T10:00:00Z"),
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
  }),
  incidentDetail: async () => ({
    incident: {
      id: "inc_fixture",
      title: "Investigating delayed deliveries",
      summary:
        "Synthetic investigation. Check backlog and provider outcomes before retrying messages.",
      status: "identified",
      severity: "sev2",
      revision: 1,
      createdBy: "qa_operator",
      createdAt: new Date("2026-10-29T09:00:00Z"),
      resolvedAt: null,
    },
    updates: [
      {
        id: "update_fixture",
        fromStatus: "investigating",
        toStatus: "identified",
        message: "Synthetic cause identified; mitigation under review.",
        actorUserId: "qa_operator",
        createdAt: new Date("2026-10-29T10:00:00Z"),
      },
    ],
  }),
}));
vi.mock("@/lib/control/queries", () => ({
  userRows: state.userRows,
  waitlistSources: async () =>
    state.empty
      ? []
      : [
          { label: "direct", count: 12 },
          { label: "referral", count: 4 },
        ],
  waitlistOverview: async () => ({ referred: state.empty ? 0 : 4, total: state.empty ? 0 : 16 }),
  billingOverview: async () => ({
    mrrCents: 99999999,
    arpuCents: 123456,
    activeCount: 4,
    pastDueCount: 0,
    canceledCount: 0,
    trialingCount: 0,
    byPlan: [],
    newSubsByMonth: [],
  }),
}));
vi.mock("@/control/_components/charts", () => import("../../app/control/_components/charts"));
vi.mock("@/control/_components/ui", () => import("../../app/control/_components/ui"));
vi.mock("../../app/control/observability/incidents/actions", () => ({
  createIncident: vi.fn(),
  updateIncident: vi.fn(),
}));
vi.mock("../../app/control/administration/actions", () => ({ setPlatformRole: vi.fn() }));
import ActivationPage from "../../app/control/growth/activation/page";
import SupportPage from "../../app/control/customers/support/page";
import AcquisitionPage from "../../app/control/growth/acquisition/page";
import BillingPage from "../../app/control/billing/page";
import IncidentsPage from "../../app/control/observability/incidents/page";
import IncidentPage from "../../app/control/observability/incidents/[id]/page";
import { RoleControls } from "../../app/control/administration/role-controls";
function capture(name: string, node: ReturnType<typeof createElement>) {
  const html = renderToStaticMarkup(node);
  if (process.env.UI_QA_DIR) {
    mkdirSync(process.env.UI_QA_DIR, { recursive: true });
    writeFileSync(join(process.env.UI_QA_DIR, `${name}.html`), html);
  }
  return html;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "founder";
  state.empty = false;
  state.userRows.mockResolvedValue({
    rows: [
      {
        id: "qa_person",
        name: "Example Customer",
        email: "qa@example.invalid",
        createdAt: new Date("2026-10-29"),
        emailVerifiedAt: new Date("2026-10-29"),
      },
    ],
    total: 1,
    page: 1,
    pages: 1,
  });
});
it("renders measured activation with explicit cohort/current-state limitations", async () => {
  const html = capture(
    "activation",
    await ActivationPage({ searchParams: Promise.resolve({ range: "30d" }) })
  );
  expect(html).toContain("not a timestamped conversion funnel");
  expect(html).toContain("33.3%");
});
it("support fetches only after deliberate search and links to guarded account details", async () => {
  capture("support-empty", await SupportPage({ searchParams: Promise.resolve({}) }));
  expect(state.userRows).not.toHaveBeenCalled();
  const html = capture(
    "support-results",
    await SupportPage({ searchParams: Promise.resolve({ q: "Example" }) })
  );
  expect(state.userRows).toHaveBeenCalledWith("Example", 1);
  expect(html).toContain("/control/customers/users/qa_person");
  expect(html).toContain("not implemented");
});
it("reports actual zero acquisition totals, not a denominator fallback of one", async () => {
  state.empty = true;
  const html = capture("acquisition-empty", await AcquisitionPage());
  expect(html).toMatch(/Total attributed<\/p><p class="cp-stat-value">0<\/p>/);
  expect(html).not.toMatch(/NaN|Infinity/);
});
it("does not equate manually assigned plan records with payment revenue", async () => {
  const html = capture("billing", await BillingPage());
  expect(html).toMatch(/MRR<\/p><p class="cp-stat-value">—<\/p>/);
  expect(html).not.toContain("₦999,999.99");
  expect(html).toContain("not paying customers");
});
it("renders private incident creation/timeline without claiming customer notifications", async () => {
  const html = capture("incidents", await IncidentsPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Create private incident");
  expect(html).toContain("No automatic paging");
  const detail = capture(
    "incident-detail",
    await IncidentPage({ params: Promise.resolve({ id: "inc_fixture" }) })
  );
  expect(detail).toContain("Investigation timeline");
  expect(detail).toContain("qa_operator");
  expect(detail).toContain("Record update");
  state.role = "security";
  expect(
    renderToStaticMarkup(await IncidentsPage({ searchParams: Promise.resolve({}) }))
  ).not.toContain("Create private incident");
});
it("replaces browser prompts with a reasoned and acknowledged role-change form", () => {
  const html = capture(
    "role-controls",
    createElement(RoleControls, {
      userId: "qa_person",
      current: "support",
      assignable: [
        { role: "support", label: "Support" },
        { role: "analyst", label: "Analyst" },
      ],
    })
  );
  expect(html).toContain("Audit reason");
  expect(html).toContain("I reviewed this account");
  expect(html).toContain("Revoke platform access");
});
