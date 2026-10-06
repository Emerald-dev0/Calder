import { describe, expect, it } from "vitest";
import { sameOriginRequest } from "./csrf";

describe("sameOriginRequest", () => {
  it("accepts same-origin browser requests", () => {
    expect(
      sameOriginRequest(
        new Request("https://app.calder.click/api/auth/logout", {
          method: "POST",
          headers: { origin: "https://app.calder.click", "sec-fetch-site": "same-origin" },
        })
      )
    ).toBe(true);
  });

  it("rejects cross-origin and same-site sibling requests", () => {
    expect(
      sameOriginRequest(
        new Request("https://app.calder.click/api/auth/logout", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        })
      )
    ).toBe(false);
    expect(
      sameOriginRequest(
        new Request("https://app.calder.click/api/auth/logout", {
          method: "POST",
          headers: { "sec-fetch-site": "same-site" },
        })
      )
    ).toBe(false);
  });

  it("accepts explicit non-browser requests without browser metadata", () => {
    expect(
      sameOriginRequest(new Request("https://app.calder.click/api/auth/logout", { method: "POST" }))
    ).toBe(true);
  });
});
