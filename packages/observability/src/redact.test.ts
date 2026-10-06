import { describe, it, expect } from "vitest";
import {
  redactText,
  redactValue,
  redactConnectionUrl,
  isSensitiveKey,
  REDACTED,
} from "./redact.js";

describe("redactValue", () => {
  it("masks credential-named keys but keeps identifiers", () => {
    const out = redactValue({
      organizationId: "org_123",
      password: "hunter2",
      apiKey: "calder_live_abcdefghijklmnop",
      webhookSecret: "whsec_abc123",
      nested: { refreshToken: "ya29.tok", email: "customer@example.com" },
      code: "validation_error",
    }) as Record<string, unknown>;
    expect(out.organizationId).toBe("org_123");
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.webhookSecret).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).refreshToken).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).email).toBe(REDACTED);
    // `code` is an API error code and must survive.
    expect(out.code).toBe("validation_error");
  });

  it("masks OTP-shaped keys, including verification_code variants", () => {
    const out = redactValue({
      verificationCode: "123456",
      verification_code: "123456",
      otp: "654321",
      resetCode: "000000",
    }) as Record<string, unknown>;
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it("scrubs secret-shaped values under innocent keys", () => {
    const out = redactValue({
      note: "token calder_test_abcdef1234567890 used",
      url: "redis://default:supersecret@redis.example:6380",
      auth: "Bearer abcdefghijklmnopqrst",
      sig: "v1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    }) as Record<string, string>;
    expect(out.note).not.toContain("calder_test_abcdef1234567890");
    expect(out.url).not.toContain("supersecret");
    expect(out.auth).not.toContain("abcdefghijklmnopqrst");
    expect(out.sig).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("survives cycles, depth and arrays without throwing", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const out = redactValue({ cyclic, list: Array.from({ length: 50 }, (_, i) => i) }) as {
      cyclic: Record<string, unknown>;
      list: unknown[];
    };
    expect(out.cyclic.name).toBe("root");
    expect(out.list.length).toBeLessThanOrEqual(20);
  });

  it("reduces errors to name, message and code", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED redis://:pw@localhost:6379"), {
      code: "ECONNREFUSED",
    });
    const out = redactValue(err) as Record<string, unknown>;
    expect(out.code).toBe("ECONNREFUSED");
    expect(String(out.message)).not.toContain("pw@");
  });
});

describe("redactText", () => {
  it("keeps the scheme and host but removes credentials from URLs", () => {
    const out = redactText("failed to connect to rediss://default:sekret@redis.example:6380");
    expect(out).toContain("redis.example:6380");
    expect(out).not.toContain("sekret");
  });

  it("masks AWS keys and webhook secrets", () => {
    const out = redactText("AKIAIOSFODNN7EXAMPLE and whsec_dev_secret_change_me");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("whsec_dev_secret_change_me");
  });

  it("truncates unbounded text", () => {
    expect(redactText("x".repeat(9000)).length).toBeLessThanOrEqual(2001);
  });

  it("leaves ordinary messages alone", () => {
    expect(redactText("Gmail daily cap reached (50/50)")).toBe("Gmail daily cap reached (50/50)");
  });
});

describe("key sensitivity", () => {
  it("classifies keys", () => {
    expect(isSensitiveKey("AUTH_SECRET")).toBe(true);
    expect(isSensitiveKey("authorization")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("otp")).toBe(true);
    expect(isSensitiveKey("verificationCode")).toBe(true);
    expect(isSensitiveKey("code")).toBe(false);
    expect(isSensitiveKey("projectId")).toBe(false);
    expect(isSensitiveKey("emailId")).toBe(false);
  });
});

describe("redactConnectionUrl", () => {
  it("returns protocol and host only", () => {
    expect(redactConnectionUrl("postgresql://calder:calder@localhost:5432/calder")).toBe(
      "postgresql://localhost:5432"
    );
    expect(redactConnectionUrl("nonsense")).toBe("[invalid-url]");
  });
});
