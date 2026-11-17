import { describe, expect, it } from "vitest";
import { can, capabilitiesForRole, inboxCapabilities } from "./inbox-permissions.js";

/**
 * Mailbox permissions.
 *
 * The security-relevant assertions are the negative ones: a viewer must not be
 * able to reply, a member with no inbox row must see nothing, and a non-member
 * of the organisation must see nothing even if an inbox row exists (that row can
 * outlive a removal).
 */
describe("inbox capabilities", () => {
  it("gives a viewer reading and nothing else", () => {
    const caps = capabilitiesForRole("viewer");
    expect(caps.view).toBe(true);
    expect(caps.reply).toBe(false);
    expect(caps.assign).toBe(false);
    expect(caps.note).toBe(false);
    expect(caps.triage).toBe(false);
    expect(caps.manageSettings).toBe(false);
    expect(caps.manageMembers).toBe(false);
  });

  it("lets a member work conversations but not govern the inbox", () => {
    const caps = capabilitiesForRole("member");
    expect(caps.view && caps.reply && caps.assign && caps.note && caps.triage).toBe(true);
    expect(caps.manageSettings).toBe(false);
    expect(caps.manageMembers).toBe(false);
  });

  it("reserves settings and membership for managers", () => {
    const caps = capabilitiesForRole("manager");
    expect(caps.manageSettings).toBe(true);
    expect(caps.manageMembers).toBe(true);
    expect(caps.reply).toBe(true);
  });

  it("treats organisation owners and admins as managers, so a workspace cannot lock itself out", () => {
    for (const role of ["owner", "admin"]) {
      const caps = inboxCapabilities({ organizationRole: role, inboxRole: null });
      expect(caps.manageMembers, role).toBe(true);
      expect(caps.manageSettings, role).toBe(true);
    }
  });

  it("gives a plain organisation member nothing without an inbox row", () => {
    const caps = inboxCapabilities({ organizationRole: "member", inboxRole: null });
    expect(caps.view).toBe(false);
    expect(can({ organizationRole: "member", inboxRole: null }, "view")).toBe(false);
  });

  it("gives a plain organisation member exactly their inbox role", () => {
    expect(can({ organizationRole: "member", inboxRole: "viewer" }, "view")).toBe(true);
    expect(can({ organizationRole: "member", inboxRole: "viewer" }, "reply")).toBe(false);
    expect(can({ organizationRole: "member", inboxRole: "manager" }, "manageMembers")).toBe(true);
  });

  it("gives nothing at all to someone with no organisation membership, even with a stale inbox row", () => {
    const caps = inboxCapabilities({ organizationRole: null, inboxRole: "manager" });
    for (const value of Object.values(caps)) expect(value).toBe(false);
  });

  it("does not let an inbox manager reach organisation-only powers", () => {
    const caps = inboxCapabilities({ organizationRole: "member", inboxRole: "manager" });
    // There is no capability here for org billing/settings/members on purpose.
    expect(Object.keys(caps).sort()).toEqual(
      ["assign", "manageMembers", "manageSettings", "note", "reply", "triage", "view"].sort()
    );
  });
});
