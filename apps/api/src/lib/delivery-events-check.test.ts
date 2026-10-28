import { describe, expect, it } from "vitest";
import { classifyDeliveryEvents } from "@calder/observability";
import { deliveryEventsCheck } from "./delivery-events-check";

const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const facts = (over: Partial<Parameters<typeof classifyDeliveryEvents>[0]> = {}) => ({
  topicArnsConfigured: true,
  lastEventAt: new Date(),
  acceptedInWindow: 5,
  windowStart,
  ...over,
});

describe("/ready delivery_events check", () => {
  it("is ok when events are arriving", () => {
    expect(deliveryEventsCheck(classifyDeliveryEvents(facts())).state).toBe("ok");
  });

  it("is ok when nothing was accepted, so there is nothing to measure", () => {
    expect(
      deliveryEventsCheck(classifyDeliveryEvents(facts({ acceptedInWindow: 0, lastEventAt: null })))
        .state
    ).toBe("ok");
  });

  it("is degraded with the dashboard's sentence when the allowlist is unset", () => {
    const check = deliveryEventsCheck(
      classifyDeliveryEvents(facts({ topicArnsConfigured: false, lastEventAt: null }))
    );
    expect(check.state).toBe("degraded");
    expect(check.detail).toContain(
      "No delivery events received — Delivered and Bounced are unknown, not zero."
    );
  });

  it("is degraded when sends happened and nothing came back", () => {
    const check = deliveryEventsCheck(
      classifyDeliveryEvents(facts({ lastEventAt: null, acceptedInWindow: 3 }))
    );
    expect(check.state).toBe("degraded");
    expect(check.detail).toContain("3 messages were accepted");
  });

  it("carries no provider-shaped detail, only our own words", () => {
    const check = deliveryEventsCheck(
      classifyDeliveryEvents(facts({ topicArnsConfigured: false, lastEventAt: null }))
    );
    // No ARNs, addresses, hostnames or request ids — the detail is composed
    // from the classifier's fixed sentences.
    expect(check.detail).not.toMatch(/arn:aws/);
    expect(check.detail).not.toContain("@");
  });
});
