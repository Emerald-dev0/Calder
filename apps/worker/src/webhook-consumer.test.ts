import { describe, it, expect } from "vitest";
import { buildSignatureHeader, verifySignature, isPublicWebhookUrl } from "./webhook-consumer.js";
import { createHmac } from "node:crypto";

describe("webhook signature vectors (M3.1)", () => {
  const secret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef";
  const body = JSON.stringify({
    id: "whd_test123",
    type: "email.delivered",
    createdAt: "2026-09-21T12:00:00.000Z",
    data: { emailId: "em_abc" },
  });
  const ts = 1_758_480_000;

  it("signs t + '.' + body with HMAC-SHA256, header is t=...,v1=...", () => {
    const header = buildSignatureHeader(secret, ts, body);
    const expectedSig = createHmac("sha256", secret).update(`${ts}.${body}`, "utf8").digest("hex");
    expect(header).toBe(`t=${ts},v1=${expectedSig}`);
  });

  it("round-trips: consumer-side verify accepts a fresh correctly-signed body", () => {
    const header = buildSignatureHeader(secret, ts, body);
    expect(verifySignature(secret, body, header, 300, ts + 30)).toBe(true);
  });

  it("rejects a tampered body (same header, different payload)", () => {
    const header = buildSignatureHeader(secret, ts, body);
    expect(verifySignature(secret, body.replace("em_abc", "em_xyz"), header, 300, ts + 30)).toBe(
      false
    );
  });

  it("rejects a wrong secret", () => {
    const header = buildSignatureHeader(secret, ts, body);
    expect(verifySignature("whsec_deadbeef" + "0".repeat(40), body, header, 300, ts + 30)).toBe(
      false
    );
  });

  it("rejects a replay outside the tolerance window", () => {
    const header = buildSignatureHeader(secret, ts, body);
    expect(verifySignature(secret, body, header, 300, ts + 600)).toBe(false);
  });

  it("rejects garbage headers", () => {
    expect(verifySignature(secret, body, "hello", 300, ts)).toBe(false);
    expect(verifySignature(secret, body, "t=1", 300, ts)).toBe(false);
    expect(verifySignature(secret, body, `t=${ts},v1=${"z".repeat(64)}`, 300, ts)).toBe(false);
  });
});

describe("worker-side SSRF re-check", () => {
  it("denies loopback, private, link-local and metadata literals", () => {
    for (const u of [
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://x.localhost/hook",
      "https://10.0.0.5/hook",
      "https://172.16.0.9/hook",
      "https://192.168.1.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://service.internal/hook",
      "ftp://example.com/hook",
    ]) {
      expect(isPublicWebhookUrl(u), u).toBe(false);
    }
  });

  it("accepts public https endpoints", () => {
    for (const u of ["https://hooks.acme.dev/calder", "https://webhook.site/abc-def"])
      expect(isPublicWebhookUrl(u), u).toBe(true);
  });
});
