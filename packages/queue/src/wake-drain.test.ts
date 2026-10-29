import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { wakeDeliveryDrain } from "./wake-drain.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("delivery drain wake-up", () => {
  it("requires API_URL rather than sending credentials to APP_URL", async () => {
    vi.stubEnv("API_URL", "");
    vi.stubEnv("APP_URL", "https://web.example");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await wakeDeliveryDrain()).toEqual({ ok: false, reason: "missing_url" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses an unauthenticated wake-up", async () => {
    vi.stubEnv("API_URL", "https://api.example");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("ADMIN_API_KEY", "");
    expect(await wakeDeliveryDrain()).toEqual({ ok: false, reason: "missing_secret" });
  });
  it("POSTs an authenticated wake-up to a real HTTP endpoint", async () => {
    let received: unknown;
    const server = createServer((req, res) => {
      received = { method: req.method, path: req.url, token: req.headers.authorization };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      vi.stubEnv("API_URL", `http://127.0.0.1:${address.port}/`);
      vi.stubEnv("CRON_SECRET", "test-only-secret");
      expect(await wakeDeliveryDrain()).toEqual({ ok: true });
      expect(received).toEqual({
        method: "POST",
        path: "/v1/cron/drain",
        token: "Bearer test-only-secret",
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("reports rejection without exposing the secret or response body", async () => {
    vi.stubEnv("API_URL", "https://api.example");
    vi.stubEnv("CRON_SECRET", "test-only-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private detail", { status: 401 }))
    );
    expect(await wakeDeliveryDrain()).toEqual({ ok: false, reason: "http_error", status: 401 });
  });
  it("redacts thrown errors and refuses redirects", async () => {
    vi.stubEnv("API_URL", "https://api.example");
    vi.stubEnv("CRON_SECRET", "test-only-secret");
    const fetcher = vi.fn().mockRejectedValue(new Error("private detail"));
    vi.stubGlobal("fetch", fetcher);
    expect(await wakeDeliveryDrain()).toEqual({ ok: false, reason: "request_failed" });
    expect(fetcher.mock.calls[0]?.[1].redirect).toBe("error");
  });
});
