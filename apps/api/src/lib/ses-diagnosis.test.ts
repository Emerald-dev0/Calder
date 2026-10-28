import { describe, expect, it } from "vitest";
import { formatSesEnv, maskTail, summarizeSesEnv } from "./ses-diagnosis";

/**
 * A diagnostic that leaks a credential into a terminal, a log or a pasted
 * message is worse than no diagnostic, so the masking is the part with tests.
 */
describe("maskTail", () => {
  it("keeps the last four characters and nothing else", () => {
    expect(maskTail("AKIAXHD7VR6LG2RGA7OJ")).toBe("A7OJ");
    expect(maskTail("AKIAXHD7VR6LG2RGA7OJ")).not.toContain("AKIA");
  });

  it("refuses to shorten a value too small to be a key", () => {
    expect(maskTail("abc")).toBeNull();
    expect(maskTail("")).toBeNull();
    expect(maskTail(undefined)).toBeNull();
  });
});

describe("summarizeSesEnv", () => {
  it("reports the region the provider will actually use", () => {
    expect(summarizeSesEnv({}).region).toBe("us-east-1");
    expect(summarizeSesEnv({}).regionIsDefault).toBe(true);
    expect(summarizeSesEnv({ AWS_REGION: "eu-west-1" }).region).toBe("eu-west-1");
    expect(summarizeSesEnv({ AWS_REGION: "eu-west-1" }).regionIsDefault).toBe(false);
  });

  it("never carries the secrets themselves", () => {
    const env = {
      AWS_ACCESS_KEY_ID: "AKIAXHD7VR6LG2RGA7OJ",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };
    const summary = summarizeSesEnv(env);
    const rendered = [JSON.stringify(summary), ...formatSesEnv(summary)].join("\n");
    expect(rendered).not.toContain("wJalrXUtnFEMI");
    expect(rendered).not.toContain("AKIAXHD7VR6LG2RGA7OJ");
    expect(rendered).toContain("A7OJ");
    expect(summary.secretSet).toBe(true);
  });

  it("names the configuration set that a send will actually attach", () => {
    const summary = summarizeSesEnv({
      SES_CONFIGURATION_SET_TRANSACTIONAL: "calder-transactional",
    });
    const lines = formatSesEnv(summary);
    expect(lines.join("\n")).toContain("calder-transactional");
    expect(lines.join("\n")).toContain("SES_CONFIGURATION_SET_TRANSACTIONAL");
  });

  it("says so when a send will attach no configuration set at all", () => {
    // The difference matters: a missing config set cannot fail a send, a
    // non-existent one fails every send with ConfigurationSetDoesNotExist.
    expect(formatSesEnv(summarizeSesEnv({})).join("\n")).toContain("none configured");
  });
});
