import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfig } from "@calder/config";
import { completeGmailConnect, startGmailConnect } from "./gmail-connect.js";

const scope = "https://www.googleapis.com/auth/gmail.send";
describe("Gmail OAuth", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("DASHBOARD_URL", "https://dashboard.example.test");
    resetConfig();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfig();
  });

  it("uses the actual callback and asks Google for an offline refresh token", () => {
    const { url } = startGmailConnect();
    const params = new URL(url).searchParams;
    expect(params.get("redirect_uri")).toBe(
      "https://dashboard.example.test/api/auth/gmail/callback"
    );
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("scope")).toContain(scope);
    expect(params.get("code_challenge_method")).toBe("S256");
  });
  it("uses verified Google userinfo with send-only Gmail access and stores refresh token", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token")
          return Response.json({
            access_token: "access",
            refresh_token: "refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: `openid email ${scope}`,
          });
        if (url === "https://openidconnect.googleapis.com/v1/userinfo")
          return Response.json({ email: "Sender@Gmail.com", email_verified: true });
        throw new Error(`unexpected request ${url}`);
      })
    );
    expect(await completeGmailConnect("code", "verifier")).toEqual({
      senderEmail: "sender@gmail.com",
      refreshToken: "refresh",
    });
    expect(requests).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://openidconnect.googleapis.com/v1/userinfo",
    ]);
  });
  it("rejects partial consent before accepting credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          access_token: "access",
          refresh_token: "refresh",
          token_type: "Bearer",
          scope: "openid email",
        })
      )
    );
    await expect(completeGmailConnect("code", "verifier")).rejects.toThrow(
      "permission was not granted"
    );
  });
});
