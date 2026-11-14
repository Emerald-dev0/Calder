import { describe, expect, it } from "vitest";
import { invitedOrgCookieHeader, orgCookieHeader } from "./org-cookie";

/**
 * The active-workspace cookie is a *hint*, but its attributes still matter: an
 * invitation is a cross-site arrival, so a cookie written without SameSite=Lax
 * would be dropped on the redirect back from a mail client, and one written
 * without HttpOnly would be readable by any script on the page.
 */

describe("orgCookieHeader", () => {
  it("writes the workspace id with the attributes the context reader expects", () => {
    const header = orgCookieHeader("org_abc", { NODE_ENV: "development" });
    expect(header.startsWith("calder_org=org_abc")).toBe(true);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=31536000");
    expect(header).not.toContain("Secure");
  });

  it("adds Secure in production only", () => {
    expect(orgCookieHeader("org_abc", { NODE_ENV: "production" })).toContain("; Secure");
    expect(orgCookieHeader("org_abc", { NODE_ENV: "test" })).not.toContain("Secure");
  });

  it("percent-encodes the value", () => {
    expect(orgCookieHeader("org a/b", { NODE_ENV: "test" })).toContain("calder_org=org%20a%2Fb");
  });
});

describe("invitedOrgCookieHeader", () => {
  it("opens the most recent invitation, which is the first id returned", () => {
    const header = invitedOrgCookieHeader(["org_newest", "org_older"], { NODE_ENV: "test" });
    expect(header).toContain("calder_org=org_newest");
  });

  it("writes nothing when this login accepted no invitation", () => {
    expect(invitedOrgCookieHeader([], { NODE_ENV: "test" })).toBeNull();
    expect(invitedOrgCookieHeader(undefined, { NODE_ENV: "test" })).toBeNull();
  });
});
