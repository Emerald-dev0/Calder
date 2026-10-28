import { describe, expect, it } from "vitest";
import {
  deliveryFailureDetail,
  errorCodeOf,
  safeDeliveryReason,
  safeErrorName,
} from "./safe-errors";

describe("safe delivery reasons", () => {
  it("keeps allowlisted operational codes", () => {
    expect(errorCodeOf({ code: "gmail_cap" })).toBe("gmail_cap");
    expect(safeDeliveryReason({ code: "gmail_cap" })).toBe("gmail_cap");
    expect(safeDeliveryReason({ code: "organization_sending_unavailable" })).toBe(
      "organization_sending_unavailable"
    );
  });

  it("never persists arbitrary provider exception text", () => {
    expect(safeDeliveryReason(new Error("provider secret=do-not-store"))).toBe("provider_error");
    expect(safeDeliveryReason({ code: "arn:aws:ses:secret" })).toBe("provider_error");
  });
});

describe("delivery failure detail", () => {
  it("keeps the leg and the error class for an unclassified failure", () => {
    // A TypeError thrown inside the fallback leg is exactly the case where
    // "provider_error" alone is useless: the operator needs to know it was our
    // code, not the provider rejecting the message.
    const err = new TypeError("Cannot read properties of undefined (reading 'id')");
    expect(deliveryFailureDetail(err, "default")).toEqual({
      code: "provider_error",
      leg: "default",
      errorName: "TypeError",
    });
  });

  it("keeps a provider verdict and its class when both are known", () => {
    class SESv2ServiceException extends Error {
      code = "MessageRejected";
    }
    expect(deliveryFailureDetail(new SESv2ServiceException("rejected"), "ses")).toEqual({
      code: "MessageRejected",
      leg: "ses",
      errorName: "SESv2ServiceException",
    });
  });

  it("never carries the message, so an address in it cannot reach the row", () => {
    const err = new Error("550 5.1.1 <recipient@customer.example> does not exist");
    const detail = deliveryFailureDetail(err, "gmail");
    expect(detail.code).toBe("provider_error");
    const serialised = JSON.stringify(detail);
    expect(serialised).not.toContain("recipient@customer.example");
    expect(serialised).not.toContain("550 5.1.1");
    expect(serialised).not.toContain("does not exist");
  });

  it("drops a leg that is not one of ours", () => {
    expect(deliveryFailureDetail(new Error("x"), "gmail; DROP TABLE").leg).toBeNull();
    expect(deliveryFailureDetail(new Error("x"), "Gmail").leg).toBeNull();
    expect(deliveryFailureDetail(new Error("x")).leg).toBeNull();
  });

  it("drops an error name that could smuggle text", () => {
    // A thrown plain object can claim any constructor name; only identifiers
    // survive, so nothing address-shaped can ride in through this field.
    const forged = Object.create({ constructor: { name: "bounce for a@b.example" } });
    expect(safeErrorName(forged)).toBeNull();
    expect(deliveryFailureDetail(forged, "default").errorName).toBeNull();
  });

  it("survives values that are not errors at all", () => {
    expect(safeErrorName(null)).toBeNull();
    expect(safeErrorName(undefined)).toBeNull();
    expect(safeErrorName("provider said no")).toBeNull();
    expect(deliveryFailureDetail(null, "default")).toEqual({
      code: "provider_error",
      leg: "default",
      errorName: null,
    });
  });

  it("does not report a bare object literal as an error class", () => {
    // `Object` is what every plain object has; it says nothing about the cause.
    expect(safeErrorName({ code: "TimeoutError" })).toBeNull();
    expect(safeErrorName(new Error("timeout"))).toBe("Error");
  });
});
