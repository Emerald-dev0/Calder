import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ createDomainSender: vi.fn(), createGmailSender: vi.fn() }));
import { AddSender } from "./add-sender";

const base = {
  projectId: "proj_1",
  verifiedDomains: ["example.test"],
  gmailTransports: [],
};

const closed = {
  offered: false,
  title: "Gmail connection · coming soon",
  note: "Gmail transport is coming soon and is not available in this release. Use the shared test sender or a verified domain for now.",
};

/**
 * The regression: the Gmail card on /senders was a live option with a working
 * "Connect Gmail with Google" link while /integrations called the same feature
 * "Coming soon". These cases pin the closed state and the two things it must
 * still say — why, and what to use instead.
 */
describe("AddSender Gmail on-ramp", () => {
  it("renders no connect link while the gate is closed", () => {
    const html = renderToStaticMarkup(createElement(AddSender, { ...base, gmail: closed }));
    expect(html).not.toContain("/api/auth/gmail/connect");
    expect(html).toContain("Coming soon");
    expect(html).toContain("verified domain for now");
  });

  it("keeps the domain path fully usable", () => {
    const html = renderToStaticMarkup(createElement(AddSender, { ...base, gmail: closed }));
    expect(html).toContain("Verify a Custom Domain");
    expect(html).toContain("example.test");
  });

  it("tells the truth about existing connections without offering a new one", () => {
    const html = renderToStaticMarkup(
      createElement(AddSender, {
        ...base,
        gmailTransports: [{ id: "tr_1", label: "dev@gmail.com" }],
        gmail: closed,
      })
    );
    expect(html).toContain("existing Gmail connection");
    expect(html).toContain("new Gmail");
    expect(html).toContain("paused");
    expect(html).not.toContain("/api/auth/gmail/connect");
  });

  it("renders the connect path only when the gate is open", () => {
    const html = renderToStaticMarkup(
      createElement(AddSender, {
        ...base,
        gmailTransports: [{ id: "tr_1", label: "dev@gmail.com" }],
        gmail: { offered: true, title: "Connect Gmail", note: "" },
      })
    );
    expect(html).toContain("Connect Gmail");
    expect(html).not.toContain("Coming soon");
  });
});
