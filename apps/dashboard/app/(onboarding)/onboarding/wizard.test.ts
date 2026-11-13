import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../(app)/onboarding/actions", () => ({
  checkUsernameAvailability: vi.fn(),
  saveOnboardingStep: vi.fn(),
  saveAndExitOnboarding: vi.fn(),
  saveProfile: vi.fn(),
  saveOrgAndProjectStep: vi.fn(),
  saveSendingSetupStep: vi.fn(),
  sendFirstEmail: vi.fn(),
  getEmailStatus: vi.fn(),
  addDomain: vi.fn(),
  checkDomainDns: vi.fn(),
  probeDomainDns: vi.fn(),
  completeOnboarding: vi.fn(),
}));
import { OnboardingWizard, type OnboardingWizardProps } from "./wizard";

const props: OnboardingWizardProps = {
  userEmail: "dev@example.test",
  gmail: {
    offered: false,
    title: "Gmail connection · coming soon",
    note: "Gmail transport is coming soon and is not available in this release. Use the shared test sender or a verified domain for now.",
  },
  initialStep: 4,
  initialNotice: null,
  initialProfile: { name: "Developer", username: "dev", role: "Developer" },
  initialOrg: { id: "org", name: "Workspace", slug: "workspace" },
  initialProject: { id: "project", name: "Project", slug: "project" },
  initialDomain: null,
  initialTransports: [],
  initialEmail: null,
};

describe("optional onboarding steps", () => {
  it("offers a setup skip only after workspace and project setup", () => {
    const essentials = renderToStaticMarkup(
      createElement(OnboardingWizard, { ...props, initialStep: 3 })
    );
    const sending = renderToStaticMarkup(createElement(OnboardingWizard, props));
    expect(essentials).not.toContain("Skip setup for now");
    expect(sending).toContain("Skip setup for now");
    expect(sending).toContain("does not reach an inbox");
  });
  it("offers a first-send skip and does not claim inbox delivery in the done state", () => {
    const send = renderToStaticMarkup(
      createElement(OnboardingWizard, { ...props, initialStep: 5 })
    );
    const done = renderToStaticMarkup(
      createElement(OnboardingWizard, { ...props, initialStep: 6 })
    );
    expect(send).toContain("Skip test and go to dashboard");
    expect(done).toContain("No email was delivered");
    expect(done).not.toContain("FIRST DELIVERY · VERIFIED");
  });
});

/**
 * The regression this guards: Step 4 showed a "Coming soon" badge on the Gmail
 * card while still rendering a live "Connect Gmail account →" link, so the
 * wizard invited a customer into a flow the registry says is not launched.
 */
describe("Gmail on-ramp", () => {
  const gmailTransport = {
    id: "tr_1",
    type: "gmail",
    label: "dev@gmail.com",
    status: "active",
    isDefault: true,
    dailyCap: null,
  };

  it("does not offer a connect link while the feature is coming soon", () => {
    const html = renderToStaticMarkup(createElement(OnboardingWizard, props));
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("/api/auth/gmail/connect");
    expect(html).not.toContain("Connect Gmail account");
  });

  it("refuses the connect link even for a project that already has a connection", () => {
    // The risky case: a transport exists from before the gate closed, which is
    // what auto-selects the Gmail card and expands its panel.
    const html = renderToStaticMarkup(
      createElement(OnboardingWizard, { ...props, initialTransports: [gmailTransport] })
    );
    expect(html).toContain("Coming soon");
    expect(html).not.toContain("/api/auth/gmail/connect");
    expect(html).toContain("Gmail transport is coming soon");
  });

  it("offers the connect link only when the gate is explicitly open", () => {
    const html = renderToStaticMarkup(
      createElement(OnboardingWizard, {
        ...props,
        initialTransports: [gmailTransport],
        gmail: { offered: true, title: "Connect Gmail", note: "" },
      })
    );
    expect(html).toContain("up to 100 sends/day");
    expect(html).not.toContain("20 first-day sends");
  });
});
