import { describe, expect, it } from "vitest";
import {
  DELIVERY_UNKNOWN_HEADLINE,
  classifyDeliveryEvents,
  describeAge,
  hasSesTopicArns,
  sesTopicArns,
} from "./delivery-events";

const now = new Date("2026-10-28T12:00:00.000Z");
const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const facts = (over: Partial<Parameters<typeof classifyDeliveryEvents>[0]> = {}) => ({
  topicArnsConfigured: true,
  lastEventAt: new Date("2026-10-28T11:58:00.000Z"),
  acceptedInWindow: 5,
  windowStart,
  now,
  ...over,
});

describe("classifyDeliveryEvents", () => {
  it("treats zeros as unknown when the topic allowlist is unset", () => {
    const health = classifyDeliveryEvents(facts({ topicArnsConfigured: false, lastEventAt: null }));
    expect(health.state).toBe("unconfigured");
    expect(health.zerosTrusted).toBe(false);
    // The exact sentence the brief asks for, because a number the UI cannot
    // defend is worse than no number.
    expect(health.headline).toBe(
      "No delivery events received — Delivered and Bounced are unknown, not zero."
    );
    expect(health.setupHref).toContain("deliverability");
  });

  it("reports unconfigured even before it knows whether a legacy event exists", () => {
    // Precedence matters: "the topic went quiet" would send an operator to
    // debug a subscription that was never made.
    const health = classifyDeliveryEvents(
      facts({ topicArnsConfigured: false, lastEventAt: new Date("2026-10-27T00:00:00.000Z") })
    );
    expect(health.state).toBe("unconfigured");
    expect(health.lastEventAt).toBe("2026-10-27T00:00:00.000Z");
  });

  it("calls a window with no accepted sends idle, not broken", () => {
    const health = classifyDeliveryEvents(facts({ lastEventAt: null, acceptedInWindow: 0 }));
    expect(health.state).toBe("idle");
    expect(health.zerosTrusted).toBe(true);
    expect(health.headline).not.toContain("unknown");
  });

  it("calls it stale when sends happened and nothing came back", () => {
    const health = classifyDeliveryEvents(facts({ lastEventAt: null }));
    expect(health.state).toBe("stale");
    expect(health.zerosTrusted).toBe(false);
    expect(health.headline).toBe(DELIVERY_UNKNOWN_HEADLINE);
    expect(health.detail).toContain("5 messages were accepted");
  });

  it("calls it stale when the last event predates the window", () => {
    const health = classifyDeliveryEvents(
      facts({ lastEventAt: new Date(windowStart.getTime() - 1) })
    );
    expect(health.state).toBe("stale");
  });

  it("calls it fresh when an event landed inside the window", () => {
    const health = classifyDeliveryEvents(facts());
    expect(health.state).toBe("fresh");
    expect(health.zerosTrusted).toBe(true);
    expect(health.setupHref).toBeNull();
    expect(health.detail).toContain("2 minutes ago");
  });

  it("accepts an event exactly on the window boundary", () => {
    expect(classifyDeliveryEvents(facts({ lastEventAt: windowStart })).state).toBe("fresh");
  });
});

describe("sesTopicArns", () => {
  it("parses a comma-separated allowlist and ignores blanks", () => {
    expect(sesTopicArns({ SES_SNS_TOPIC_ARNS: " arn:a , ,arn:b " } as NodeJS.ProcessEnv)).toEqual([
      "arn:a",
      "arn:b",
    ]);
    expect(hasSesTopicArns({ SES_SNS_TOPIC_ARNS: "arn:a" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("treats unset and whitespace-only as not configured", () => {
    expect(hasSesTopicArns({} as NodeJS.ProcessEnv)).toBe(false);
    expect(hasSesTopicArns({ SES_SNS_TOPIC_ARNS: "   " } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("describeAge", () => {
  it("stays coarse and grammatical", () => {
    expect(describeAge(0)).toBe("just now");
    expect(describeAge(60_000)).toBe("1 minute ago");
    expect(describeAge(3 * 60_000)).toBe("3 minutes ago");
    expect(describeAge(2 * 3_600_000)).toBe("2 hours ago");
    expect(describeAge(3 * 86_400_000)).toBe("3 days ago");
  });
});
