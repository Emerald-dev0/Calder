import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BachsBillingProvider, BillingNotConfiguredError } from "./provider.js";
import { createBillingService } from "./service.js";

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

const BODY = JSON.stringify({ event: "collection.succeeded", amount: 500000 });

describe("Bachs webhook verification", () => {
  const provider = new BachsBillingProvider({
    BACHS_API_KEY: "sk_live_test",
    BACHS_WEBHOOK_SECRET: "whsec_test_secret",
  });

  it("accepts a correctly signed payload", () => {
    expect(provider.verifyWebhookSignature(BODY, sign(BODY, "whsec_test_secret"))).toBe(true);
  });

  it("accepts the prefixed forms providers use", () => {
    const digest = sign(BODY, "whsec_test_secret");
    expect(provider.verifyWebhookSignature(BODY, `sha256=${digest}`)).toBe(true);
    expect(provider.verifyWebhookSignature(BODY, `v1=${digest}`)).toBe(true);
    expect(provider.verifyWebhookSignature(BODY, `t=1700000000, sha256=${digest}`)).toBe(true);
  });

  it("rejects a body that was altered after signing", () => {
    const tampered = JSON.stringify({ event: "collection.succeeded", amount: 5 });
    expect(provider.verifyWebhookSignature(tampered, sign(BODY, "whsec_test_secret"))).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(provider.verifyWebhookSignature(BODY, sign(BODY, "not-the-secret"))).toBe(false);
  });

  it("rejects an empty or garbage signature without throwing", () => {
    expect(provider.verifyWebhookSignature(BODY, "")).toBe(false);
    expect(provider.verifyWebhookSignature(BODY, "not-hex")).toBe(false);
    // A digest of a different length must fail the comparison, not crash it.
    expect(provider.verifyWebhookSignature(BODY, "abc123")).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    // The old implementation returned true whenever a secret merely existed,
    // and this is the other half of that bug: no secret must mean "no trust".
    const unconfigured = new BachsBillingProvider({});
    expect(unconfigured.verifyWebhookSignature(BODY, sign(BODY, ""))).toBe(false);
    expect(unconfigured.verifyWebhookSignature(BODY, sign(BODY, "anything"))).toBe(false);
  });

  it("is reachable through the service, which no longer hardcodes false", () => {
    const service = createBillingService(provider);
    expect(service.verifyWebhook(BODY, sign(BODY, "whsec_test_secret"))).toBe(true);
    expect(service.verifyWebhook(BODY, "deadbeef")).toBe(false);
  });
});

describe("Bachs checkout", () => {
  it("refuses to invent a successful checkout without an API key", async () => {
    const provider = new BachsBillingProvider({});
    await expect(
      provider.createCheckoutSession({
        organizationId: "org_1",
        planId: "pro",
        successUrl: "https://app.calder.click/usage?ok=1",
        cancelUrl: "https://app.calder.click/usage",
      })
    ).rejects.toBeInstanceOf(BillingNotConfiguredError);
  });

  it("never returns a URL that would look like a completed payment", async () => {
    // The previous stub returned `successUrl?plan=…&mock=true`, which sent the
    // customer back to the app as if they had paid. Nothing may do that.
    const provider = new BachsBillingProvider({ BACHS_API_KEY: "sk_live_test" });
    await expect(
      provider.createCheckoutSession({
        organizationId: "org_1",
        planId: "pro",
        successUrl: "https://app.calder.click/usage",
        cancelUrl: "https://app.calder.click/usage",
      })
    ).rejects.toMatchObject({ code: "billing_not_configured" });
  });
});
