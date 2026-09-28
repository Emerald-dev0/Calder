import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sanitizeHeaders, resolveEmailStream } from "./email-service.js";

describe("sanitizeHeaders", () => {
  it("passes List-Unsubscribe headers through", () => {
    expect(
      sanitizeHeaders({
        "List-Unsubscribe": "<https://x.test/u>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      })
    ).toEqual({
      "List-Unsubscribe": "<https://x.test/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("passes X- prefixed custom headers", () => {
    expect(sanitizeHeaders({ "X-Calder-Tag": "welcome" })).toEqual({
      "X-Calder-Tag": "welcome",
    });
  });

  it("drops envelope and dangerous headers", () => {
    expect(
      sanitizeHeaders({
        From: "evil@x.test",
        To: "victim@x.test",
        Subject: "hijacked",
        "Content-Type": "text/html",
        Received: "by evil",
        Bcc: "spam@x.test",
        "X-Ok": "yes",
      })
    ).toEqual({ "X-Ok": "yes" });
  });

  it("drops empty and oversized values", () => {
    expect(sanitizeHeaders({ "X-A": "", "X-B": "x".repeat(2001) })).toEqual({});
  });

  it("returns empty for undefined", () => {
    expect(sanitizeHeaders(undefined)).toEqual({});
  });
});

/**
 * Reputation streams (transactional | marketing). The hard rule: stream is an
 * ANNOTATION, never an authority — choosing marketing must not relax
 * suppression, quota, consent, or sender verification.
 */
describe("resolveEmailStream", () => {
  it("defaults to transactional when absent or unrecognized", () => {
    expect(resolveEmailStream({})).toBe("transactional");
    expect(resolveEmailStream({ stream: undefined })).toBe("transactional");
    // Non-schema callers (internal mail, older SDK payloads) stay transactional.
    expect(resolveEmailStream({ stream: "promotional" as never })).toBe("transactional");
  });

  it("only marketing opt-in selects the marketing lane", () => {
    expect(resolveEmailStream({ stream: "marketing" })).toBe("marketing");
    expect(resolveEmailStream({ stream: "transactional" })).toBe("transactional");
  });

  it("is a pure mapping — no gate input can change its result", () => {
    // Same input, same output: nothing about suppression/quota state is
    // consulted here, by construction.
    expect(resolveEmailStream({ stream: "marketing" })).toBe(
      resolveEmailStream({ stream: "marketing" })
    );
  });
});

describe("stream cannot bypass send gates (source guard)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./email-service.ts", import.meta.url)),
    "utf8"
  );
  const at = (anchor: string) => {
    const i = source.indexOf(anchor);
    expect(i, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
    return i;
  };

  it("sender resolution, suppression and quota gates run BEFORE the stream is recorded", () => {
    const annotation = at("stream: resolveEmailStream(input)");
    expect(at("resolveSender(")).toBeLessThan(annotation); // sender verification
    expect(at("── Suppression check")).toBeLessThan(annotation);
    expect(at("── Quota check")).toBeLessThan(annotation);
    expect(at("Sender identity resolution")).toBeLessThan(annotation);
  });

  it("no control flow branches on the stream value", () => {
    // The ONLY place stream is inspected is the pure `resolveEmailStream`
    // mapping; everywhere else it is a plain field. Anything outside that
    // function comparing or branching on it would be a bypass vector.
    const start = source.indexOf("export function resolveEmailStream");
    expect(start).toBeGreaterThan(-1);
    const resolver = source.slice(start, source.indexOf("\n}\n", start) + 3);
    expect(resolver).toContain('input.stream === "marketing"');
    const rest = source.replace(resolver, "");
    expect(rest).not.toMatch(/if\s*\([^)]*\bstream\b/i);
    expect(rest).not.toMatch(/\bstream\b\s*(===|!==|\?\?)/);
    expect(rest).not.toMatch(/\bstream\b\s*\?\s*["']/);
    expect(rest).not.toMatch(/\.where\([^;]*\bstream\b/i);
  });

  it("marks Calder's own mail transactional unconditionally", () => {
    expect(source).toMatch(/stream:\s*"transactional"/);
  });
});
