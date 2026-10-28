import { describe, expect, it } from "vitest";
import {
  deliveryFailureDetail,
  errorCodeOf,
  httpStatusOf,
  providerEvidence,
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

/**
 * The outage these tests exist for.
 *
 * Every send failed for hours and the only trace left anywhere was the word
 * "provider_error": the SDK reported `AccessDeniedException` (or an unverified
 * identity, or a missing configuration set), the allowlist did not contain
 * that spelling, and nothing logged the exception before it was dropped.
 */
describe("provider exceptions that used to be erased", () => {
  /** What an AWS SDK failure looks like: the API's code is the `name`. */
  class SESv2ServiceException extends Error {
    override name = "AccessDeniedException";
    $metadata = { httpStatusCode: 403 };
  }

  it("keeps the exception name the SDK actually throws", () => {
    expect(safeDeliveryReason({ name: "AccessDeniedException" })).toBe("AccessDeniedException");
    expect(safeDeliveryReason({ name: "MailFromDomainNotVerifiedException" })).toBe(
      "MailFromDomainNotVerifiedException"
    );
    expect(safeDeliveryReason({ name: "ConfigurationSetDoesNotExistException" })).toBe(
      "ConfigurationSetDoesNotExistException"
    );
    expect(safeDeliveryReason({ name: "UnrecognizedClientException" })).toBe(
      "UnrecognizedClientException"
    );
  });

  it("reads the code from `name` when the transport set no `code`", () => {
    expect(errorCodeOf({ name: "BadRequestException" })).toBe("BadRequestException");
    expect(errorCodeOf({ code: "gmail_cap", name: "SomethingElse" })).toBe("gmail_cap");
    expect(errorCodeOf({})).toBeNull();
  });

  it("still refuses a name that is not a provider code", () => {
    // The point of widening the list is precision, not permissiveness: an
    // unknown identifier must still degrade to the honest fallback.
    expect(safeDeliveryReason({ name: "SomethingWentWrong" })).toBe("provider_error");
    expect(safeDeliveryReason({ code: "arn:aws:ses:us-east-1:123:configuration-set/x" })).toBe(
      "provider_error"
    );
  });

  it("names the exception, not the SDK's wrapper class", () => {
    // `SESv2ServiceException` is what every AWS failure looks like from the
    // constructor, so the old field said the same word for all of them.
    expect(deliveryFailureDetail(new SESv2ServiceException("denied"), "ses")).toEqual({
      code: "AccessDeniedException",
      leg: "ses",
      errorName: "AccessDeniedException",
    });
  });

  it("carries the HTTP status, which separates 403 from 400 from 429", () => {
    expect(httpStatusOf(new SESv2ServiceException("denied"))).toBe(403);
    expect(httpStatusOf({ $metadata: { httpStatusCode: 999 } })).toBeNull();
    expect(httpStatusOf({ $metadata: { httpStatusCode: "403" } })).toBeNull();
    expect(httpStatusOf(new Error("no metadata"))).toBeNull();
    expect(providerEvidence(new SESv2ServiceException("denied"))).toEqual({
      code: "AccessDeniedException",
      errorName: "AccessDeniedException",
      httpStatus: 403,
    });
  });

  it("cannot be talked into persisting an address", () => {
    const forged = { name: "noreply@intake.calder.click" };
    expect(safeErrorName(forged)).toBeNull();
    expect(JSON.stringify(providerEvidence(forged))).not.toContain("@");
  });
});
