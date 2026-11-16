import { describe, it, expect } from "vitest";
import {
  buildTriageQueue,
  countTriage,
  hostOf,
  hoursBetween,
  plural,
  sortTriageItems,
  DOMAIN_STUCK_AFTER_HOURS,
  FAILING_SENDS_THRESHOLD,
  type TriageInput,
  type TriageItem,
} from "./triage";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function emptyInput(): TriageInput {
  return {
    now: NOW,
    pausedWorkspaces: [],
    pendingDeletions: [],
    problemDomains: [],
    failingWebhooks: [],
    failingProjects: [],
    blockedSenders: [],
    revokedTransports: [],
  };
}

describe("buildTriageQueue", () => {
  it("returns an empty queue with zero counts when nothing is wrong", () => {
    const q = buildTriageQueue(emptyInput());
    expect(q.items).toEqual([]);
    expect(q.counts).toEqual({ total: 0, critical: 0, high: 0, normal: 0 });
    expect(q.unreadable).toEqual([]);
  });

  it("treats a suspended workspace as critical and names it", () => {
    const input = emptyInput();
    input.pausedWorkspaces = [
      {
        id: "org_1",
        name: "Acme",
        status: "suspended",
        sendingStatusReason: "phishing reports",
        sendingStatusAt: hoursAgo(5),
      },
    ];
    const item = buildTriageQueue(input).items[0]!;
    expect(item.kind).toBe("workspace-paused");
    expect(item.severity).toBe("critical");
    expect(item.title).toContain("Acme");
    expect(item.detail).toContain("phishing reports");
    expect(item.detail).toContain("5 hours");
    expect(item.href).toBe("/control/customers/organizations/org_1");
  });

  it("distinguishes an automatic abuse pause from an operator suspension", () => {
    const input = emptyInput();
    input.pausedWorkspaces = [
      {
        id: "a",
        name: "A",
        status: "abuse_paused",
        sendingStatusReason: null,
        sendingStatusAt: null,
      },
      { id: "b", name: "B", status: "suspended", sendingStatusReason: null, sendingStatusAt: null },
    ];
    const q = buildTriageQueue(input);
    const a = q.items.find((i) => i.id === "workspace-paused:a")!;
    const b = q.items.find((i) => i.id === "workspace-paused:b")!;
    expect(a.detail).toContain("abuse");
    expect(b.detail).toContain("Operators suspended");
    expect(a.detail).toContain("unknown");
  });

  it("escalates a deletion whose grace window is about to close", () => {
    const input = emptyInput();
    input.pendingDeletions = [
      {
        id: "soon",
        name: "Soon Co",
        deletionRequestedAt: hoursAgo(150),
        deletionScheduledFor: hoursAhead(12),
      },
      {
        id: "later",
        name: "Later Co",
        deletionRequestedAt: hoursAgo(10),
        deletionScheduledFor: hoursAhead(120),
      },
      {
        id: "overdue",
        name: "Overdue Co",
        deletionRequestedAt: hoursAgo(200),
        deletionScheduledFor: hoursAgo(2),
      },
    ];
    const q = buildTriageQueue(input);
    const byId = (id: string) => q.items.find((i) => i.id === `deletion-pending:${id}`)!;
    expect(byId("overdue").severity).toBe("critical");
    expect(byId("overdue").title).toContain("due for purge");
    expect(byId("soon").severity).toBe("critical");
    expect(byId("later").severity).toBe("normal");
    expect(byId("later").detail).toContain("5 days");
  });

  it("ignores a domain that is only minutes old", () => {
    const input = emptyInput();
    input.problemDomains = [
      {
        id: "d1",
        domain: "fresh.example",
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        createdAt: hoursAgo(DOMAIN_STUCK_AFTER_HOURS - 1),
        lastVerifyError: null,
      },
    ];
    expect(buildTriageQueue(input).items).toEqual([]);
  });

  it("reports a stuck pending domain as normal once the record is overdue", () => {
    const input = emptyInput();
    input.problemDomains = [
      {
        id: "d1",
        domain: "stuck.example",
        status: "pending",
        organizationId: "org_1",
        organizationName: "Acme",
        createdAt: hoursAgo(72),
        lastVerifyError: "no TXT record",
      },
    ];
    const item = buildTriageQueue(input).items[0]!;
    expect(item.severity).toBe("normal");
    expect(item.kind).toBe("domain-stuck");
    expect(item.title).toContain("3 days");
    expect(item.detail).toContain("no TXT record");
    expect(item.href).toBe("/control/customers/domains?status=pending&q=stuck.example");
  });

  it("reports failed and expired domains as high regardless of age", () => {
    const input = emptyInput();
    input.problemDomains = [
      {
        id: "d1",
        domain: "broken.example",
        status: "failed",
        organizationId: "o",
        organizationName: "O",
        createdAt: hoursAgo(1),
        lastVerifyError: "wrong token",
      },
      {
        id: "d2",
        domain: "old.example",
        status: "expired",
        organizationId: "o",
        organizationName: "O",
        createdAt: hoursAgo(200),
        lastVerifyError: null,
      },
    ];
    const q = buildTriageQueue(input);
    expect(q.items.map((i) => i.severity)).toEqual(["high", "high"]);
    expect(q.items.map((i) => i.kind)).toEqual(["domain-failed", "domain-failed"]);
  });

  it("links a failing webhook by host and keeps the full URL out of the title", () => {
    const input = emptyInput();
    input.failingWebhooks = [
      {
        id: "w1",
        url: "https://hooks.customer.example/inbound/very/long/path?token=secret",
        organizationName: "Acme",
        failedAttempts: 6,
        lastError: "503 from endpoint",
        lastAttemptAt: hoursAgo(2),
      },
    ];
    const item = buildTriageQueue(input).items[0]!;
    expect(item.title).toContain("hooks.customer.example");
    expect(item.title).not.toContain("secret");
    expect(item.detail).toContain("6 deliveries");
    expect(item.detail).toContain("503 from endpoint");
    expect(item.href).toBe("/control/platform/webhooks");
  });

  it("ignores a project with fewer failures than the threshold", () => {
    const input = emptyInput();
    input.failingProjects = [
      {
        projectId: "p1",
        projectName: "App",
        organizationId: "o",
        organizationName: "O",
        failed: FAILING_SENDS_THRESHOLD - 1,
        bounced: 0,
        windowHours: 24,
      },
    ];
    expect(buildTriageQueue(input).items).toEqual([]);
  });

  it("summarises failing sends per project, with bounces when there are any", () => {
    const input = emptyInput();
    input.failingProjects = [
      {
        projectId: "p1",
        projectName: "App",
        organizationId: "o",
        organizationName: "O",
        failed: 12,
        bounced: 4,
        windowHours: 24,
      },
    ];
    const item = buildTriageQueue(input).items[0]!;
    expect(item.title).toBe("App: 12 sends failed in 24 hours");
    expect(item.detail).toContain("4 messages bounced");
    expect(item.since).toBeNull();
  });

  it("reports blocked senders and revoked transports as high", () => {
    const input = emptyInput();
    input.blockedSenders = [
      {
        id: "s1",
        email: "hello@acme.test",
        organizationId: "o1",
        organizationName: "Acme",
        status: "failed",
        statusReason: "domain not verified",
        updatedAt: hoursAgo(30),
      },
    ];
    input.revokedTransports = [
      {
        id: "t1",
        label: "ops@acme.test",
        type: "gmail",
        organizationId: "o1",
        organizationName: "Acme",
        updatedAt: hoursAgo(48),
      },
    ];
    const q = buildTriageQueue(input);
    expect(q.items).toHaveLength(2);
    expect(q.items.every((i) => i.severity === "high")).toBe(true);
    const sender = q.items.find((i) => i.kind === "sender-blocked")!;
    expect(sender.detail).toContain("domain not verified");
    const transport = q.items.find((i) => i.kind === "transport-revoked")!;
    expect(transport.title).toContain("gmail");
  });

  it("orders critical before high before normal, oldest first inside a rank", () => {
    const input = emptyInput();
    input.pausedWorkspaces = [
      {
        id: "new",
        name: "New",
        status: "suspended",
        sendingStatusReason: null,
        sendingStatusAt: hoursAgo(1),
      },
      {
        id: "old",
        name: "Old",
        status: "suspended",
        sendingStatusReason: null,
        sendingStatusAt: hoursAgo(80),
      },
    ];
    input.failingProjects = [
      {
        projectId: "p",
        projectName: "P",
        organizationId: "o",
        organizationName: "O",
        failed: 4,
        bounced: 0,
        windowHours: 24,
      },
    ];
    input.problemDomains = [
      {
        id: "d",
        domain: "stuck.example",
        status: "pending",
        organizationId: "o",
        organizationName: "O",
        createdAt: hoursAgo(60),
        lastVerifyError: null,
      },
    ];
    const q = buildTriageQueue(input);
    expect(q.items.map((i) => i.severity)).toEqual(["critical", "critical", "high", "normal"]);
    expect(q.items[0]!.title).toContain("Old");
    expect(q.counts).toEqual({ total: 4, critical: 2, high: 1, normal: 1 });
  });

  it("gives every item a unique id", () => {
    const input = emptyInput();
    input.pausedWorkspaces = [
      {
        id: "x",
        name: "X",
        status: "suspended",
        sendingStatusReason: null,
        sendingStatusAt: hoursAgo(1),
      },
    ];
    input.problemDomains = [
      {
        id: "x",
        domain: "x.example",
        status: "failed",
        organizationId: "o",
        organizationName: "O",
        createdAt: hoursAgo(2),
        lastVerifyError: null,
      },
    ];
    input.failingProjects = [
      {
        projectId: "x",
        projectName: "X",
        organizationId: "o",
        organizationName: "O",
        failed: 9,
        bounced: 0,
        windowHours: 24,
      },
    ];
    const ids = buildTriageQueue(input).items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("triage helpers", () => {
  it("counts by severity", () => {
    const items = [
      { severity: "critical" },
      { severity: "critical" },
      { severity: "normal" },
    ] as TriageItem[];
    expect(countTriage(items)).toEqual({ total: 3, critical: 2, high: 0, normal: 1 });
  });

  it("sorts without mutating the input array", () => {
    const items = [
      { id: "b", severity: "normal", since: null },
      { id: "a", severity: "critical", since: null },
    ] as TriageItem[];
    const sorted = sortTriageItems(items);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("is stable for items with no known start", () => {
    const items = [
      { id: "z", severity: "high", since: null },
      { id: "a", severity: "high", since: null },
    ] as TriageItem[];
    expect(sortTriageItems(items).map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("formats hostnames defensively", () => {
    expect(hostOf("https://hooks.acme.test/path")).toBe("hooks.acme.test");
    expect(hostOf("not a url")).toBe("not a url");
  });

  it("computes hours and pluralises", () => {
    expect(hoursBetween(NOW, hoursAhead(3))).toBe(3);
    expect(plural(1, "send")).toBe("1 send");
    expect(plural(2, "send")).toBe("2 sends");
    expect(plural(2, "delivery", "deliveries")).toBe("2 deliveries");
  });
});
