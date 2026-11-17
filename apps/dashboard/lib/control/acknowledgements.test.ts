import { describe, it, expect } from "vitest";
import {
  ACK_COOLDOWN_HOURS,
  ackExpiresAt,
  fingerprintOf,
  latestAcksByItem,
  reopenReasonLabel,
  splitByAcknowledgement,
  verdictFor,
  type AckRecord,
} from "./acknowledgements";
import type { TriageItem } from "./triage";

const NOW = new Date("2026-04-01T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function item(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "domain:dom_1",
    kind: "domain-failed",
    severity: "high",
    title: "broken.example is failed",
    detail: "Ownership verification did not complete.",
    href: "/control/customers/domains?status=failed",
    organizationName: "Acme",
    since: hoursAgo(30),
    evidence: "status=failed",
    ...overrides,
  };
}

function ack(overrides: Partial<AckRecord> = {}): AckRecord {
  const target = item();
  return {
    id: "ack_1",
    itemId: target.id,
    fingerprint: fingerprintOf(target),
    title: target.title,
    note: "customer is on it",
    acknowledgedByUserId: "usr_1",
    acknowledgedByEmail: "ops@calder.test",
    acknowledgedAt: hoursAgo(1),
    reopenedAt: null,
    ...overrides,
  } as AckRecord;
}

describe("fingerprintOf", () => {
  it("is stable for the same condition", () => {
    expect(fingerprintOf(item())).toBe(fingerprintOf(item()));
  });

  it("changes when the evidence changes", () => {
    expect(fingerprintOf(item())).not.toBe(fingerprintOf(item({ evidence: "status=pending" })));
  });

  it("changes when severity escalates", () => {
    expect(fingerprintOf(item())).not.toBe(fingerprintOf(item({ severity: "critical" })));
  });

  it("distinguishes two different items of the same kind", () => {
    expect(fingerprintOf(item())).not.toBe(fingerprintOf(item({ id: "domain:dom_2" })));
  });

  it("is short enough for the column it is stored in", () => {
    expect(fingerprintOf(item()).length).toBeLessThanOrEqual(64);
  });
});

describe("verdictFor", () => {
  it("leaves an item open when nothing was ever acknowledged", () => {
    expect(verdictFor(item(), undefined, NOW)).toEqual({ acknowledged: false, reason: "none" });
  });

  it("covers an item acknowledged moments ago", () => {
    const verdict = verdictFor(item(), ack(), NOW);
    expect(verdict.acknowledged).toBe(true);
    if (verdict.acknowledged) {
      expect(verdict.expiresAt.getTime()).toBe(
        ack().acknowledgedAt.getTime() + ACK_COOLDOWN_HOURS * 3_600_000
      );
    }
  });

  it("reopens immediately when the evidence changed", () => {
    const changed = item({ evidence: "status=expired" });
    const verdict = verdictFor(changed, ack(), NOW);
    expect(verdict).toEqual({ acknowledged: false, reason: "evidence-changed" });
  });

  it("lapses on its own after the cooldown", () => {
    const old = ack({ acknowledgedAt: hoursAgo(ACK_COOLDOWN_HOURS + 1) });
    expect(verdictFor(item(), old, NOW)).toEqual({ acknowledged: false, reason: "expired" });
  });

  it("is still acknowledged one minute before the cooldown ends", () => {
    const justInside = ack({ acknowledgedAt: hoursAgo(ACK_COOLDOWN_HOURS - 0.01) });
    expect(verdictFor(item(), justInside, NOW).acknowledged).toBe(true);
  });

  it("respects an explicit reopen even inside the cooldown", () => {
    const reopened = ack({ reopenedAt: hoursAgo(0.5) });
    expect(verdictFor(item(), reopened, NOW)).toEqual({ acknowledged: false, reason: "reopened" });
  });
});

describe("latestAcksByItem", () => {
  it("keeps the newest record per item regardless of input order", () => {
    const older = ack({ id: "ack_old", acknowledgedAt: hoursAgo(5) });
    const newer = ack({ id: "ack_new", acknowledgedAt: hoursAgo(1) });
    const map = latestAcksByItem([newer, older]);
    expect(map.get("domain:dom_1")?.id).toBe("ack_new");
  });

  it("keeps items independent", () => {
    const other = ack({
      id: "ack_2",
      itemId: "domain:dom_2",
      fingerprint: fingerprintOf(item({ id: "domain:dom_2" })),
    });
    const map = latestAcksByItem([ack(), other]);
    expect(map.size).toBe(2);
  });
});

describe("splitByAcknowledgement", () => {
  it("separates the queue into open and acknowledged without losing rows", () => {
    const covered = item();
    const fresh = item({ id: "domain:dom_2", evidence: "status=pending" });
    const split = splitByAcknowledgement([covered, fresh], [ack()], NOW);
    expect(split.open.map((i) => i.id)).toEqual(["domain:dom_2"]);
    expect(split.acknowledged.map((a) => a.item.id)).toEqual(["domain:dom_1"]);
    expect(split.open.length + split.acknowledged.length).toBe(2);
  });

  it("reopens an item whose condition got worse", () => {
    const worse = item({ severity: "critical", evidence: "status=expired" });
    const split = splitByAcknowledgement([worse], [ack()], NOW);
    expect(split.acknowledged).toEqual([]);
    expect(split.open).toHaveLength(1);
  });

  it("ignores acknowledgements for items that are no longer in the queue", () => {
    const split = splitByAcknowledgement([item()], [ack({ itemId: "domain:gone" })], NOW);
    expect(split.open).toHaveLength(1);
    expect(split.acknowledged).toEqual([]);
  });

  it("handles an empty queue", () => {
    expect(splitByAcknowledgement([], [ack()], NOW)).toEqual({ open: [], acknowledged: [] });
  });
});

describe("ackExpiresAt and reasons", () => {
  it("computes the lapse time from the acknowledgement", () => {
    const record = ack({ acknowledgedAt: new Date("2026-04-01T00:00:00.000Z") });
    expect(ackExpiresAt(record).toISOString()).toBe("2026-04-02T00:00:00.000Z");
  });

  it("explains a reopen and an expiry, and stays quiet otherwise", () => {
    expect(reopenReasonLabel(ack({ reopenedAt: hoursAgo(1) }), NOW)).toMatch(/reopened/);
    expect(reopenReasonLabel(ack({ acknowledgedAt: hoursAgo(30) }), NOW)).toMatch(/lapsed/);
    expect(reopenReasonLabel(ack(), NOW)).toBeNull();
    expect(reopenReasonLabel(undefined, NOW)).toBeNull();
  });
});
