import { describe, it, expect } from "vitest";
import { WAITLIST_UPDATE_001, renderCampaign } from "./waitlist-update-001.js";

describe("waitlist-update-001", () => {
  it("fills every placeholder with no leftovers", () => {
    const out = renderCampaign(WAITLIST_UPDATE_001, {
      email: "ada@example.com",
      position: 42,
      referral_code: "ABC123XY",
      referral_link: "https://x.test/waitlist?ref=ABC123XY",
    });
    for (const doc of [out.subject, out.html, out.text]) {
      expect(doc).not.toContain("{{");
      expect(doc).not.toContain("}}");
    }
    expect(out.html).toContain("#42");
    expect(out.html).toContain("ABC123XY");
    expect(out.text).toContain("#42");
    expect(out.text).toContain("https://x.test/waitlist?ref=ABC123XY");
  });
});
