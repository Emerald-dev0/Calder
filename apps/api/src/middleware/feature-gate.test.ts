import { describe, expect, it, vi } from "vitest";
import { assertFeatureAvailable, requireFeature } from "./feature-gate.js";

/**
 * The gate is the difference between "the dashboard hides it" and "the API
 * refuses it". Both directions matter: a ready feature must pass through
 * untouched, and a coming-soon feature must never reach a handler.
 */
describe("requireFeature", () => {
  it("passes a ready feature through to the handler", async () => {
    const next = vi.fn(async () => {});
    const middleware = requireFeature("email_templates");
    // The middleware ignores the Hono context for a ready feature.
    await middleware({} as never, next as never);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("refuses a coming-soon feature with a 403 and a stable code", async () => {
    const next = vi.fn(async () => {});
    const middleware = requireFeature("broadcasts");
    await expect(middleware({} as never, next as never)).rejects.toMatchObject({
      code: "feature_not_available",
      status: 403,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses inbound email and the SMTP gateway", async () => {
    for (const id of ["inbound_email", "smtp_gateway", "advanced_analytics"] as const) {
      const next = vi.fn(async () => {});
      await expect(requireFeature(id)({} as never, next as never)).rejects.toMatchObject({
        code: "feature_not_available",
      });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("refuses a feature whose product is not in the MVP even though code exists", async () => {
    const middleware = requireFeature("audiences");
    await expect(middleware({} as never, vi.fn() as never)).rejects.toMatchObject({
      status: 403,
    });
  });
});

/**
 * `requireFeature` guards a mount point; `assertFeatureAvailable` guards one
 * branch of a route that also serves launched workflows. Gmail is the case that
 * forced it: `POST /v1/senders` must keep serving domain senders while refusing
 * `type: "gmail"`, so the decision had to become callable inside the handler.
 */
describe("assertFeatureAvailable", () => {
  it("allows a ready feature", () => {
    expect(() => assertFeatureAvailable("sender_identities")).not.toThrow();
  });

  it("refuses the Gmail on-ramp with the same 403 the middleware returns", () => {
    expect(() => assertFeatureAvailable("gmail_integration")).toThrowError(
      expect.objectContaining({ code: "feature_not_available", status: 403 })
    );
  });

  it("names the feature and its status in details, so support can act on it", () => {
    try {
      assertFeatureAvailable("gmail_integration");
      throw new Error("expected a refusal");
    } catch (error) {
      const details = (error as { details?: { feature?: string; status?: string } }).details;
      expect(details?.feature).toBe("gmail_integration");
      expect(details?.status).toBe("coming_soon");
    }
  });
});
