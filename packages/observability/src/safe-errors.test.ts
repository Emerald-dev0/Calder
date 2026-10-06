import { describe, expect, it } from "vitest";
import { errorCodeOf, safeDeliveryReason } from "./safe-errors";

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
