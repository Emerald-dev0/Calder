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
