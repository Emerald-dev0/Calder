import { describe, it, expect } from "vitest";
import { isPublicWebhookUrl } from "./webhook-url.js";

describe("registry SSRF guard (M3.1, write side)", () => {
  it("denies private/loopback/metadata URLs at registration", () => {
    for (const u of [
      "http://127.0.0.1/hook",
      "https://10.1.2.3/",
      "https://192.168.0.10/",
      "https://172.20.0.1/",
      "http://localhost:8080/hook",
      "https://169.254.0.9/",
      "https://100.70.0.1/", // CGNAT
      "https://255.255.255.255/",
      "https://hook.local/",
      "https://user:pass@example.com/hook",
      "javascript:alert(1)",
    ]) {
      expect(isPublicWebhookUrl(u), u).toBe(false);
    }
  });

  it("denies plain http for production URLs", () => {
    expect(isPublicWebhookUrl("http://hooks.acme.dev/calder")).toBe(false);
  });

  it("accepts public https", () => {
    expect(isPublicWebhookUrl("https://hooks.acme.dev/calder?key=1")).toBe(true);
  });

  it("loopback escape hatch exists ONLY when explicitly enabled", () => {
    expect(isPublicWebhookUrl("http://localhost:3000/hook", { allowLoopback: true })).toBe(true);
    expect(isPublicWebhookUrl("http://localhost:3000/hook")).toBe(false);
  });
});
