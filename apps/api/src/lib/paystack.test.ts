import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPaymentMatches,
  initializeTransaction,
  refundTransaction,
  verifyPaystackSignature,
  verifyTransaction,
} from "./paystack.js";

describe("Paystack client", () => {
  beforeEach(() => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_calder");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only a valid HMAC-SHA512 signature over the raw body", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "r1" } });
    const good = createHmac("sha512", "sk_test_calder").update(body).digest("hex");
    expect(verifyPaystackSignature(body, good)).toBe(true);
    expect(verifyPaystackSignature(body, good.toUpperCase())).toBe(true);
    expect(verifyPaystackSignature(body, "0".repeat(128))).toBe(false);
    expect(verifyPaystackSignature(body, undefined)).toBe(false);
    // A reserialised body has different bytes and must fail.
    expect(verifyPaystackSignature(JSON.stringify(JSON.parse(body), null, 2), good)).toBe(false);
  });

  it("refuses to verify when no secret key is configured", () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect(verifyPaystackSignature("{}", "abc")).toBe(false);
  });

  it("requires an exact integer amount and USD currency before fulfilment", () => {
    expect(() =>
      assertPaymentMatches(
        { status: "success", amount: 500, currency: "USD" },
        { amountCents: 500, currency: "USD" }
      )
    ).not.toThrow();
    expect(() =>
      assertPaymentMatches(
        { status: "success", amount: 500_00, currency: "NGN" },
        { amountCents: 500_00, currency: "USD" }
      )
    ).toThrow(/Currency mismatch/);
    expect(() =>
      assertPaymentMatches(
        { status: "success", amount: 499, currency: "USD" },
        { amountCents: 500, currency: "USD" }
      )
    ).toThrow(/Amount mismatch/);
    expect(() =>
      assertPaymentMatches(
        { status: "failed", amount: 500, currency: "USD" },
        { amountCents: 500, currency: "USD" }
      )
    ).toThrow(/not successful/);
    expect(() =>
      assertPaymentMatches(
        { status: "success", amount: 5.5, currency: "USD" },
        { amountCents: 5.5, currency: "USD" }
      )
    ).toThrow(/Amount mismatch/);
  });

  it("initializes a USD transaction with integer minor units", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: true,
            data: {
              authorization_url: "https://checkout.paystack.com/x",
              access_code: "ac",
              reference: "ref_1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const result = await initializeTransaction(
      {
        email: "a@b.test",
        amountCents: 500,
        currency: "USD",
        reference: "ref_1",
        metadata: { organizationId: "org_1" },
      },
      fetchMock as unknown as typeof fetch
    );
    expect(result.authorization_url).toContain("paystack");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: 500,
      currency: "USD",
      reference: "ref_1",
      email: "a@b.test",
    });
    await expect(
      initializeTransaction(
        { email: "a@b.test", amountCents: 5.5, currency: "USD", reference: "r" },
        fetchMock as unknown as typeof fetch
      )
    ).rejects.toThrow(/positive integer/);
  });

  it("verifies a transaction by reference and rejects provider errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: false, message: "Transaction not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
    );
    await expect(
      verifyTransaction("missing", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(/Transaction not found/);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.paystack.co/transaction/verify/missing",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("sends refunds in integer minor units", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: true, data: { id: 1, status: "pending" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const result = await refundTransaction(
      { transaction: "ref_1", amountCents: 250 },
      fetchMock as unknown as typeof fetch
    );
    expect(result.status).toBe("pending");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ transaction: "ref_1", amount: 250 });
  });
});
