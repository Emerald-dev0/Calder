import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyDeliveryEvents, type DeliveryEventHealth } from "@calder/observability";
import { DeliveryEventNotice, DeliveryStatValue, deliverySubline } from "./delivery-event-notice";

const now = new Date("2026-10-28T12:00:00.000Z");
const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const unconfigured = classifyDeliveryEvents({
  topicArnsConfigured: false,
  lastEventAt: null,
  acceptedInWindow: 5,
  windowStart,
  now,
});
const fresh = classifyDeliveryEvents({
  topicArnsConfigured: true,
  lastEventAt: new Date(now.getTime() - 60_000),
  acceptedInWindow: 5,
  windowStart,
  now,
});

const render = (health: DeliveryEventHealth) =>
  renderToStaticMarkup(createElement(DeliveryEventNotice, { health, projectId: "proj_1" }));

describe("DeliveryStatValue", () => {
  it("prints Unknown instead of a zero it cannot defend", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryStatValue, { count: 0, health: unconfigured, testId: "delivered" })
    );
    expect(html).toContain("Unknown");
    // The whole point: the card must not read as a measurement of zero.
    expect(html).not.toMatch(/>\s*0\s*</);
  });

  it("still prints a non-zero count when events did arrive", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryStatValue, { count: 3, health: unconfigured })
    );
    expect(html).toContain("3");
    expect(html).not.toContain("Unknown");
  });

  it("prints the real zero when feedback is flowing", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryStatValue, { count: 0, health: fresh })
    );
    expect(html).toMatch(/>\s*0\s*</);
    expect(html).not.toContain("Unknown");
  });
});

describe("DeliveryEventNotice", () => {
  it("renders the exact sentence and a way to fix it", () => {
    const html = render(unconfigured);
    expect(html).toContain(
      "No delivery events received — Delivered and Bounced are unknown, not zero."
    );
    expect(html).toContain("SES_SNS_TOPIC_ARNS");
    // Link to setup, and a way to see the raw events.
    expect(html).toContain("calder.click/docs/deliverability");
    expect(html).toContain("/deliveries?project=proj_1");
  });

  it("disappears when delivery events are arriving", () => {
    expect(render(fresh)).toBe("");
  });

  it("words the card sub-line the same way as the banner", () => {
    expect(deliverySubline(unconfigured, "Confirmed by provider")).toBe(
      "Unknown — no delivery events received"
    );
    expect(deliverySubline(fresh, "Confirmed by provider")).toBe("Confirmed by provider");
  });
});
