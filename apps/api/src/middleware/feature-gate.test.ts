import { describe, expect, it, vi } from "vitest";
import { requireFeature } from "./feature-gate.js";

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
