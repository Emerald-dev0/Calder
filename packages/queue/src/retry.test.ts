import { describe, it, expect } from "vitest";
import { isTransientError } from "./retry.js";

/**
 * Classification contract used by the delivery drain. These pin down the two
 * real-world shapes that were previously misread as permanent: a provider
 * error that carries `statusCode` (not `status`), and the SESv2 rate-limit
 * name `TooManyRequestsException`.
 */
describe("isTransientError", () => {
  const withProps = (props: Record<string, unknown>, message = "boom") => {
    const e = new Error(message) as Error & Record<string, unknown>;
    Object.assign(e, props);
    return e;
  };

  it("honours an explicit provider verdict over message guessing", () => {
    expect(isTransientError(withProps({ transient: true }, "rejected"))).toBe(true);
    expect(isTransientError(withProps({ transient: false }, "rate limit exceeded"))).toBe(false);
  });

  it("reads statusCode as well as status", () => {
    expect(isTransientError(withProps({ statusCode: 429 }))).toBe(true);
    expect(isTransientError(withProps({ statusCode: 503 }))).toBe(true);
    expect(isTransientError(withProps({ statusCode: 400 }))).toBe(false);
    expect(isTransientError(withProps({ status: 429 }))).toBe(true);
  });

  it("matches throttling codes loosely (TooManyRequests / Throttling*)", () => {
    expect(isTransientError(withProps({ code: "TooManyRequestsException" }))).toBe(true);
    expect(isTransientError(withProps({ code: "ThrottlingException" }))).toBe(true);
    expect(isTransientError(withProps({ code: "Throttling" }))).toBe(true);
    expect(isTransientError(withProps({ code: "MessageRejected" }))).toBe(false);
  });

  it("still treats timeouts and 5xx message text as transient", () => {
    expect(isTransientError(new Error("socket timeout"))).toBe(true);
    expect(isTransientError(new Error("provider returned 502"))).toBe(true);
    expect(isTransientError(new Error("Email address is not verified."))).toBe(false);
  });
});
