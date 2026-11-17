import { describe, expect, it } from "vitest";
import { COMPANY_EMAIL_IDS, OPTIONAL_CATEGORY_LIST } from "@calder/notify";
import { buildCustomerNotificationsView } from "./customer-view";

const preferences = (disabled: string[] = []) => ({
  disabled,
  optional: [...OPTIONAL_CATEGORY_LIST],
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "ce_1",
  template: "billing.receipt",
  category: "billing",
  subject: "Your receipt",
  status: "sent",
  createdAt: new Date("2026-03-01T10:00:00Z"),
  sentAt: new Date("2026-03-01T10:00:05Z"),
  ...overrides,
});

describe("buildCustomerNotificationsView", () => {
  it("offers exactly the categories a person may switch off", () => {
    const view = buildCustomerNotificationsView({ preferences: preferences(), history: [] });
    expect(view.cards.map((card) => card.category)).toEqual([...OPTIONAL_CATEGORY_LIST]);
    expect(view.cards.every((card) => card.disabled === false)).toBe(true);
  });

  it("marks the categories this person has switched off", () => {
    const view = buildCustomerNotificationsView({
      preferences: preferences(["digest"]),
      history: [],
    });
    expect(view.cards.find((card) => card.category === "digest")?.disabled).toBe(true);
    expect(view.cards.find((card) => card.category === "updates")?.disabled).toBe(false);
  });

  it("gives every card a title and an explanation, never a raw enum", () => {
    const view = buildCustomerNotificationsView({ preferences: preferences(), history: [] });
    for (const card of view.cards) {
      expect(card.title).not.toBe(card.category);
      expect(card.title.length).toBeGreaterThan(3);
      expect(card.note.length).toBeGreaterThan(10);
    }
  });

  it("carries no catalogue vocabulary — no trigger, audience, data list or template id", () => {
    const view = buildCustomerNotificationsView({ preferences: preferences(), history: [row()] });
    const serialised = JSON.stringify(view);
    for (const forbidden of ["trigger", "audience", "template", '"data"', "mandatory"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("names no mandatory template id anywhere in the payload", () => {
    const view = buildCustomerNotificationsView({ preferences: preferences(), history: [row()] });
    const serialised = JSON.stringify(view);
    const mandatory = COMPANY_EMAIL_IDS.filter(
      (id) => !OPTIONAL_CATEGORY_LIST.some((category) => id.startsWith(`${category}.`))
    );
    expect(mandatory.length).toBeGreaterThan(0);
    for (const id of mandatory) {
      expect(serialised).not.toContain(id);
    }
  });

  it("keeps only subject, status and time from a history row", () => {
    const view = buildCustomerNotificationsView({
      preferences: preferences(),
      history: [row({ template: "security.password_changed", category: "security" })],
    });
    expect(view.history).toEqual([
      { id: "ce_1", subject: "Your receipt", status: "sent", at: new Date("2026-03-01T10:00:05Z") },
    ]);
    expect(Object.keys(view.history[0]!).sort()).toEqual(["at", "id", "status", "subject"]);
  });

  it("falls back to created time when the send never happened", () => {
    const createdAt = new Date("2026-03-02T09:00:00Z");
    const view = buildCustomerNotificationsView({
      preferences: preferences(),
      history: [row({ sentAt: null, status: "skipped", createdAt })],
    });
    expect(view.history[0]!.at).toBe(createdAt);
    expect(view.history[0]!.status).toBe("skipped");
  });

  it("renders an empty history as an empty list, not as an error", () => {
    const view = buildCustomerNotificationsView({ preferences: preferences(), history: [] });
    expect(view.history).toEqual([]);
  });
});
