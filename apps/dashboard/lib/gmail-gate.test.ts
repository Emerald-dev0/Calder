import { describe, expect, it } from "vitest";
import { gmailGate } from "./gmail-gate";

/**
 * The Gmail on-ramp shipped as a live button in two surfaces while the registry
 * told three others it was "coming soon". These cases pin the rule that closes
 * that gap: an offer requires both a launched product and working credentials,
 * and a closed gate always explains itself.
 */
describe("gmailGate", () => {
  it("refuses while the registry says coming soon", () => {
    const gate = gmailGate({ available: false, credentials: true });
    expect(gate.offered).toBe(false);
    expect(gate.title).toContain("coming soon");
    expect(gate.note).toMatch(/coming soon/i);
  });

  it("refuses a launched feature with no Google credentials configured", () => {
    const gate = gmailGate({ available: true, credentials: false });
    expect(gate.offered).toBe(false);
    expect(gate.title).toContain("not configured");
    expect(gate.note).toContain("OAuth credentials");
  });

  it("offers the connect action only when both facts are true", () => {
    const gate = gmailGate({ available: true, credentials: true });
    expect(gate.offered).toBe(true);
    expect(gate.note).toBe("");
  });

  it("always explains itself when closed", () => {
    for (const gate of [
      gmailGate({ available: false, credentials: true }),
      gmailGate({ available: false, credentials: false }),
      gmailGate({ available: true, credentials: false }),
    ]) {
      expect(gate.offered).toBe(false);
      expect(gate.note.length).toBeGreaterThan(20);
      // The fallback is part of the promise: a closed gate must leave the
      // customer a working path, not just a refusal.
      expect(gate.note).toMatch(/verified domain|shared test sender/i);
    }
  });

  it("reads the shipped registry by default, which is closed today", () => {
    // Pins the current launch state. If this fails because the registry was
    // deliberately flipped to `ready`, update the expectation in the same
    // commit as the launch decision — do not delete the test.
    expect(gmailGate({ credentials: true }).offered).toBe(false);
  });
});
