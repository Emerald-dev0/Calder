import { describe, expect, it } from "vitest";
import { senderLocalPart, SenderInputError } from "./service";

describe("sender address input", () => {
  it("accepts a local name and a full address on the selected domain", () => {
    expect(senderLocalPart(" Support ", "orvnlabs.com")).toBe("support");
    expect(senderLocalPart("Support@ORVNLABS.COM", "orvnlabs.com")).toBe("support");
  });
  it("does not silently create an address on another domain", () => {
    expect(() => senderLocalPart("hello@intake.calder.click", "orvnlabs.com")).toThrow(
      SenderInputError
    );
    expect(() => senderLocalPart("hello@intake.calder.click", "orvnlabs.com")).toThrow(
      /selected verified domain/
    );
    expect(() => senderLocalPart("a@b@orvnlabs.com", "orvnlabs.com")).toThrow(SenderInputError);
  });
  it("rejects invalid and empty local names", () => {
    for (const value of ["", ".bad", "bad space", "hello@orvnlabs.com.evil"]) {
      expect(() => senderLocalPart(value, "orvnlabs.com")).toThrow(SenderInputError);
    }
  });
});
