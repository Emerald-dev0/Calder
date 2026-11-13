import { describe, it, expect } from "vitest";
import { ACCEPTED_EMAIL_STATUSES, summarisePlatformEmailVolume } from "./email-volume";

type VolumeInput = Parameters<typeof summarisePlatformEmailVolume>[0];

const summarise = (over: Partial<VolumeInput> = {}) =>
  summarisePlatformEmailVolume({
    envRows: [],
    statusRows: [],
    lifetimeRows: 0,
    firstAcceptedAt: null,
    lastAcceptedAt: null,
    sendingOrgs: 0,
    ...over,
  });

describe("platform email volume", () => {
  it("counts only statuses the provider accepted", () => {
    // The four statuses here are the whole definition of "sent"; anything a
    // page counts differently is a second opinion the admin cannot reconcile.
    expect([...ACCEPTED_EMAIL_STATUSES]).toEqual(["sent", "delivered", "bounced", "complained"]);
  });

  it("splits live volume from mocked test sends instead of adding them together", () => {
    const v = summarise({
      envRows: [
        { env: "live", value: "41" },
        { env: "test", value: 9 },
      ],
    });
    expect(v.liveAccepted).toBe(41);
    expect(v.testAccepted).toBe(9);
  });

  it("reports zero, not undefined, when a deployment has never sent anything", () => {
    const v = summarise();
    expect(v).toMatchObject({
      liveAccepted: 0,
      testAccepted: 0,
      lifetimeRows: 0,
      byStatus: [],
      firstAcceptedAt: null,
      lastAcceptedAt: null,
      sendingOrgs: 0,
    });
  });

  it("orders the breakdown by pipeline stage and drops empty rows", () => {
    const v = summarise({
      statusRows: [
        { status: "delivered", value: "30" },
        { status: "created", value: "4" },
        { status: "sent", value: 2 },
        { status: "bounced", value: "0" },
      ],
    });
    expect(v.byStatus).toEqual([
      { status: "created", count: 4 },
      { status: "sent", count: 2 },
      { status: "delivered", count: 30 },
    ]);
  });

  it("keeps a status it has not seen before at the end rather than discarding it", () => {
    // A future status added to the enum must still be counted; silently
    // dropping it would make the breakdown disagree with the total.
    const v = summarise({
      statusRows: [
        { status: "delivered", value: 3 },
        { status: "quarantined", value: 7 },
      ],
    });
    expect(v.byStatus.map((r) => r.status)).toEqual(["delivered", "quarantined"]);
    expect(v.byStatus.at(-1)).toEqual({ status: "quarantined", count: 7 });
  });

  it("keeps the lifetime row count independent of what was accepted", () => {
    // Rows that never left Calder (queued, failed, suppressed) still exist and
    // are the difference between "created" and "sent" on the page.
    const v = summarise({
      envRows: [{ env: "live", value: 10 }],
      lifetimeRows: "14",
    });
    expect(v.liveAccepted).toBe(10);
    expect(v.lifetimeRows).toBe(14);
  });
});
