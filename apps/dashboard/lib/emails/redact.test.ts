import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  redactHeaders,
  redactText,
  redactValue,
  redactedJson,
  MASK,
} from "./redact";

describe("isSensitiveKey", () => {
  it("catches the header and field names that carry credentials", () => {
    for (const key of [
      "authorization",
      "Authorization",
      "Proxy-Authorization",
      "x-api-key",
      "api_key",
      "apiKey",
      "secret",
      "webhook_secret",
      "signing-secret",
      "password",
      "token",
      "access_token",
      "set-cookie",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("leaves ordinary fields alone", () => {
    for (const key of ["subject", "to", "from", "messageId", "template", "stream"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("redactText", () => {
  it("masks a Calder secret key but keeps its non-secret prefix", () => {
    const out = redactText("key=calder_sk_live_abcdef123456");
    expect(out).not.toContain("abcdef123456");
    expect(out.startsWith("key=calder_sk_live_")).toBe(true);
    expect(out).toContain(MASK);
  });

  it("masks a webhook signing secret", () => {
    const out = redactText("whsec_abcdef0123456789");
    expect(out).not.toContain("whsec_abcdef0123456789");
    expect(out.startsWith("whsec_")).toBe(true);
  });

  it("masks a bearer token", () => {
    const out = redactText("Authorization: Bearer abcdefghijklmnop");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out.startsWith("Authorization: Bearer ")).toBe(true);
  });

  it("masks a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactText(`token ${jwt}`);
    expect(out).not.toContain(jwt);
  });

  it("masks an AWS access key id", () => {
    expect(redactText("AKIAIOSFODNN7EXAMPLE")).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("leaves ordinary provider text intact so a bounce reason stays readable", () => {
    const text = "smtp; 550 5.1.1 <user@example.com>: Recipient address rejected";
    expect(redactText(text)).toBe(text);
  });

  it("does not mangle a short word that merely starts like a token", () => {
    expect(redactText("Bearer of bad news")).toBe("Bearer of bad news");
  });
});

describe("redactValue", () => {
  it("masks by key regardless of the value", () => {
    const out = redactValue({
      authorization: "Bearer abc",
      headers: { "x-api-key": "anything" },
    }) as Record<string, unknown>;
    expect(out.authorization).toBe(MASK);
    expect((out.headers as Record<string, unknown>)["x-api-key"]).toBe(MASK);
  });

  it("masks by value when the key is innocent", () => {
    const out = redactValue({ last_error: "401 from calder_sk_test_zzzzzzzzzz" }) as Record<
      string,
      unknown
    >;
    expect(String(out.last_error)).not.toContain("zzzzzzzzzz");
  });

  it("walks nested objects and arrays", () => {
    const out = redactValue({
      data: { list: [{ token: "abc" }, { name: "ok" }] },
    }) as { data: { list: Array<Record<string, unknown>> } };
    expect(out.data.list[0]!.token).toBe(MASK);
    expect(out.data.list[1]!.name).toBe("ok");
  });

  it("preserves nulls, numbers and booleans", () => {
    const out = redactValue({ a: null, b: 3, c: true }) as Record<string, unknown>;
    expect(out).toEqual({ a: null, b: 3, c: true });
  });

  it("caps depth so a pathological payload cannot hang the render", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(JSON.stringify(redactValue(deep))).toContain("[truncated]");
  });
});

describe("redactHeaders", () => {
  it("parses a newline-delimited header blob", () => {
    const out = redactHeaders("From: a@example.com\nAuthorization: Bearer abcdefghijkl");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "From", value: "a@example.com" });
    // An Authorization header is masked wholesale: even the scheme is not
    // worth echoing back, and the value is useless once the token is gone.
    expect(out[1]!.value).toBe(MASK);
  });

  it("accepts an object and an array of pairs", () => {
    expect(redactHeaders({ "X-Entity-Ref": "abc" })).toEqual([
      { name: "X-Entity-Ref", value: "abc" },
    ]);
    expect(redactHeaders([["X-A", "1"]])).toEqual([{ name: "X-A", value: "1" }]);
  });

  it("returns nothing for absent headers rather than throwing", () => {
    expect(redactHeaders(null)).toEqual([]);
    expect(redactHeaders(undefined)).toEqual([]);
    expect(redactHeaders("")).toEqual([]);
  });
});

describe("redactedJson", () => {
  it("pretty-prints and redacts in one step", () => {
    const out = redactedJson({ metadata: { apiKeyId: "key_live_1" }, secret: "x" });
    expect(out).toContain('"apiKeyId"');
    expect(out).toContain(MASK);
    expect(out).not.toContain('"secret": "x"');
  });

  it("never throws on a cyclic object: the depth cap cuts the cycle", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const out = redactedJson(cyclic);
    expect(out).toContain("[truncated]");
  });
});
