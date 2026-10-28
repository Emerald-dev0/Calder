import { describe, expect, it } from "vitest";
import { describeTransport } from "./transport";

describe("message panel: transport wording", () => {
  it("names the transport that delivered", () => {
    expect(describeTransport({ status: "sent", transport: "gmail" })).toEqual({
      value: "gmail",
      mono: true,
    });
  });

  it("never prints a dash for a failed message", () => {
    // The regression: `transport ?? "—"` on a row whose transport is null
    // because only the success branch writes it.
    const out = describeTransport({ status: "failed", transport: null });
    expect(out.value).not.toContain("—");
    expect(out.value).toBe("Not delivered by any transport");
  });

  it("lists the legs that were tried, in order", () => {
    expect(
      describeTransport({ status: "failed", transport: null, attempted: ["gmail", "default"] })
        .value
    ).toBe("Not delivered by any transport (tried gmail, default)");
  });

  it("says a suppressed message was not sent, rather than showing a blank", () => {
    expect(describeTransport({ status: "suppressed", transport: null }).value).toBe(
      "Not sent; recipient is suppressed"
    );
  });

  it("does not claim a queued message was routed", () => {
    expect(describeTransport({ status: "queued", transport: null }).value).toBe("Not sent yet");
  });

  it("keeps an accepted row honest when the transport is missing", () => {
    const out = describeTransport({ status: "delivered", transport: null });
    expect(out.value).not.toContain("—");
    expect(out.value).toContain("not recorded");
  });
});
