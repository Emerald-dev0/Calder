import { describe, it, expect } from "vitest";
import { emptyStatusCounts, summariseInbound } from "./inbound-summary";

const base = {
  windowDays: 30,
  statusRows: [],
  domainRows: [],
  inboxes: 0,
  unrouted: 0,
};

describe("summariseInbound", () => {
  it("reports null rates when nothing has happened, not zero", () => {
    const s = summariseInbound(base);
    expect(s.total).toBe(0);
    expect(s.parseFailureRate).toBeNull();
    expect(s.domainVerifiedRate).toBeNull();
    expect(s.counts).toEqual(emptyStatusCounts());
  });

  it("adds up every status into the window total", () => {
    const s = summariseInbound({
      ...base,
      statusRows: [
        { status: "received", n: 2 },
        { status: "parsed", n: 5 },
        { status: "routed", n: 3 },
        { status: "failed", n: "4" },
        { status: "rejected", n: 1 },
      ],
    });
    expect(s.counts).toEqual({ received: 2, parsed: 5, routed: 3, failed: 4, rejected: 1 });
    expect(s.total).toBe(15);
  });

  it("computes the parse failure rate over processed mail only", () => {
    const s = summariseInbound({
      ...base,
      statusRows: [
        { status: "received", n: 100 }, // queued: not a parse outcome
        { status: "parsed", n: 9 },
        { status: "routed", n: 81 },
        { status: "failed", n: 10 },
        { status: "rejected", n: 50 }, // a policy decision, not a failure
      ],
    });
    // 10 failed of 100 processed, not of 250 total.
    expect(s.parseFailureRate).toBe(10);
  });

  it("does not let an all-failed batch divide by zero", () => {
    const s = summariseInbound({ ...base, statusRows: [{ status: "failed", n: 3 }] });
    expect(s.parseFailureRate).toBe(100);
  });

  it("counts receiving domains and their verified share", () => {
    const s = summariseInbound({
      ...base,
      domainRows: [
        { status: "verified", n: 3 },
        { status: "pending", n: 2 },
        { status: "verifying", n: 1 },
        { status: "failed", n: 1 },
        { status: "disabled", n: 1 },
      ],
    });
    expect(s.domains).toEqual({
      total: 8,
      verified: 3,
      pending: 2,
      verifying: 1,
      failed: 1,
      disabled: 1,
    });
    expect(s.domainVerifiedRate).toBe(37.5);
  });

  it("keeps the total equal to its parts, including unrecognised values", () => {
    const s = summariseInbound({
      ...base,
      domainRows: [
        { status: "verified", n: 1 },
        { status: "mystery" as never, n: 2 },
      ],
    });
    expect(s.domains.total).toBe(3);
    expect(s.domains.verified).toBe(1);
    // The unknown bucket is in the total (it exists) but in no known column,
    // so the page cannot claim every domain is in a state it recognises.
    expect(
      s.domains.verified +
        s.domains.pending +
        s.domains.verifying +
        s.domains.failed +
        s.domains.disabled
    ).toBeLessThan(s.domains.total);
  });

  it("passes through inbox and unrouted counts untouched", () => {
    const s = summariseInbound({ ...base, inboxes: 4, unrouted: 7 });
    expect(s.inboxes).toBe(4);
    expect(s.unrouted).toBe(7);
  });
});
