import { describe, it, expect, vi, afterEach } from "vitest";
import { buildGmailMime, base64UrlEncode, GmailTransport } from "./gmail";

// GmailTransport reads OAuth client config lazily — stub it for tests.
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildGmailMime", () => {
  it("builds multipart when both bodies exist", () => {
    const mime = buildGmailMime({
      from: "a@gmail.com",
      to: "b@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("Content-Type: text/plain");
    expect(mime).toContain("Content-Type: text/html");
    expect(mime).toContain("Subject: Hi");
  });

  it("passes safe custom headers, drops the rest", () => {
    const mime = buildGmailMime({
      from: "a@gmail.com",
      to: "b@example.com",
      subject: "Hi",
      text: "Hi",
      headers: { "X-Calder-Tag": "welcome", "Bad Header;": "x" },
    });
    expect(mime).toContain("X-Calder-Tag: welcome");
    expect(mime).not.toContain("Bad Header;");
  });

  it("round-trips through base64url without padding or unsafe chars", () => {
    const encoded = base64UrlEncode(
      buildGmailMime({
        from: "a@gmail.com",
        to: "b@example.com",
        subject: "Héllo ✓",
        text: "Hi",
      })
    );
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    expect(decoded).toContain("Héllo ✓");
  });
});

describe("GmailTransport", () => {
  it("sends through the Gmail API and returns the message id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.includes("oauth2.googleapis.com")) {
          return new Response(
            JSON.stringify({ access_token: "tok", expires_in: 3600, token_type: "Bearer" }),
            {
              status: 200,
            }
          );
        }
        expect(target).toContain("gmail.googleapis.com");
        expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer tok");
        return new Response(JSON.stringify({ id: "gmail_msg_1" }), { status: 200 });
      })
    );
    const transport = new GmailTransport({ refreshToken: "rt", senderEmail: "dev@gmail.com" }, 400);
    const result = await transport.send({
      from: "ignored-spoof@gmail.com",
      to: "b@example.com",
      subject: "Hi",
      text: "Hi",
    });
    expect(result.providerMessageId).toBe("gmail_msg_1");
    expect(result.provider).toBe("gmail");
    expect(result.accepted).toBe(true);
  });

  it("maps revocation to a permanent, explainable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 }))
    );
    const transport = new GmailTransport({ refreshToken: "dead", senderEmail: "dev@gmail.com" });
    await expect(
      transport.send({ from: "x", to: "y", subject: "s", text: "t" })
    ).rejects.toMatchObject({ code: "gmail_revoked", transient: false });
  });

  it("rejects empty messages before any network call", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const transport = new GmailTransport({ refreshToken: "rt", senderEmail: "dev@gmail.com" });
    await expect(transport.send({ from: "x", to: "y", subject: "s" })).rejects.toMatchObject({
      code: "gmail_validation",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("advertises conservative capabilities", () => {
    const transport = new GmailTransport({ refreshToken: "rt", senderEmail: "dev@gmail.com" });
    const caps = transport.getCapabilities();
    expect(caps.dailyLimit).toBe(400);
    expect(caps.supportsTemplates).toBe(false);
    expect(caps.notes.length).toBeGreaterThan(0);
  });
});
