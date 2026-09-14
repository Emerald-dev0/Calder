import { describe, expect, it } from "vitest";
import { resolveEmailProvider, EmailProviderNotConfiguredError } from "./resolve";

const configured = {
  NODE_ENV: "production",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "secret",
  AWS_REGION: "eu-west-1",
  SES_FROM_DOMAIN: "calder.click",
} as NodeJS.ProcessEnv;

describe("resolveEmailProvider", () => {
  it("uses SES when credentials are present", () => {
    const status = resolveEmailProvider(configured);
    expect(status.driver).toBe("ses");
    expect(status.deliverable).toBe(true);
    expect(status.reason).toBeNull();
    expect(status.provider.name).toBe("ses");
  });

  it("falls back to the mock provider in development, and says why", () => {
    const status = resolveEmailProvider({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    expect(status.driver).toBe("mock");
    expect(status.deliverable).toBe(false);
    expect(status.reason).toContain("AWS_ACCESS_KEY_ID");
    expect(status.provider.name).toBe("mock");
  });

  it("throws in production rather than silently simulating sends", () => {
    expect(() => resolveEmailProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      EmailProviderNotConfiguredError
    );
  });

  it("still allows an explicit mock override (tests, preview deploys)", () => {
    const status = resolveEmailProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv, {
      allowMock: true,
    });
    expect(status.driver).toBe("mock");
  });

  it("treats credentials without a from-domain as configured, with a warning", () => {
    const status = resolveEmailProvider({
      ...configured,
      SES_FROM_DOMAIN: undefined,
    } as NodeJS.ProcessEnv);
    expect(status.deliverable).toBe(true);
    expect(status.warnings.join(" ")).toContain("SES_FROM_DOMAIN");
  });

  it("names every missing credential in the error", () => {
    try {
      resolveEmailProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
      throw new Error("expected resolveEmailProvider to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EmailProviderNotConfiguredError);
      expect((err as Error).message).toContain("AWS_ACCESS_KEY_ID");
      expect((err as Error).message).toContain("AWS_SECRET_ACCESS_KEY");
    }
  });
});
