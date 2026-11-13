import { describe, expect, it } from "vitest";
import { interpretFailure } from "./checkout";

/**
 * These cases are the promise the UI makes to someone who has just been asked
 * for money: an unconfigured deployment must say so instead of looking broken,
 * and no failure may ever imply a charge happened.
 */
describe("interpretFailure", () => {
  it("treats an unconfigured provider as a deployment state, not an error", () => {
    const result = interpretFailure(503, {
      error: { code: "payments_unavailable", message: "PAYSTACK_SECRET_KEY is required." },
    });
    expect(result.code).toBe("not_configured");
    expect(result.notConfigured).toBe(true);
    expect(result.error).toContain("nothing was charged");
  });

  it("separates a missing subscription plan code from a missing secret key", () => {
    const result = interpretFailure(503, {
      error: {
        code: "plan_not_configured",
        message: "Paystack plan code for pro is not configured",
      },
    });
    expect(result.code).toBe("plan_not_configured");
    expect(result.notConfigured).toBe(true);
    // The operator-facing detail names an env var; the customer must not see it.
    expect(result.error).not.toContain("PAYSTACK_PLAN");
  });

  it("falls back to not_configured for a bare 503 with no body", () => {
    expect(interpretFailure(503, null).code).toBe("not_configured");
  });

  it("does not leak another tenant's reference existence", () => {
    const result = interpretFailure(404, { error: { code: "payment_not_found" } });
    expect(result.code).toBe("not_found");
    expect(result.error).not.toContain("payment_not_found");
  });

  it("keeps a scope refusal actionable instead of generic", () => {
    expect(interpretFailure(403, null).code).toBe("forbidden");
  });

  it("never suggests success on an unknown failure", () => {
    for (const status of [400, 409, 422, 500, 502]) {
      const result = interpretFailure(status, { error: { code: "boom", message: "Boom." } });
      expect(result.notConfigured).toBe(false);
      expect(result.error).toContain("Boom.");
    }
  });

  it("includes the status when the body carries no message", () => {
    expect(interpretFailure(500, null).error).toContain("500");
  });
});
