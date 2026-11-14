/**
 * Mailbox permissions.
 *
 * One pure function decides what a person may do in one inbox, from two facts:
 * their organisation role and their explicit membership of that inbox. Nothing
 * else — no route, no server action, no API endpoint — is allowed to invent its
 * own rule, because a parallel permission system is how "viewers" end up able to
 * reply in one code path and not another.
 *
 * The shape is capabilities rather than a hierarchy of roles, because the
 * questions callers actually ask are "may I reply?" and "may I manage members?",
 * and answering those with a role comparison hides the difference between the
 * inbox role and the organisation role.
 */

export type InboxRole = "viewer" | "member" | "manager";

export interface InboxCapabilities {
  /** Open the inbox, read conversations and attachments. */
  view: boolean;
  /** Send a reply from inside the conversation. */
  reply: boolean;
  /** Assign or unassign a conversation. */
  assign: boolean;
  /** Add internal notes (never sent to the customer). */
  note: boolean;
  /** Change conversation status and labels. */
  triage: boolean;
  /** Rename the inbox, set its default sender, edit routes. */
  manageSettings: boolean;
  /** Add/remove inbox members and change their roles. */
  manageMembers: boolean;
}

const NONE: InboxCapabilities = {
  view: false,
  reply: false,
  assign: false,
  note: false,
  triage: false,
  manageSettings: false,
  manageMembers: false,
};

const VIEWER: InboxCapabilities = { ...NONE, view: true };

const MEMBER: InboxCapabilities = {
  ...VIEWER,
  reply: true,
  assign: true,
  note: true,
  triage: true,
};

const MANAGER: InboxCapabilities = {
  ...MEMBER,
  manageSettings: true,
  manageMembers: true,
};

export function capabilitiesForRole(role: InboxRole | null | undefined): InboxCapabilities {
  switch (role) {
    case "manager":
      return MANAGER;
    case "member":
      return MEMBER;
    case "viewer":
      return VIEWER;
    default:
      return NONE;
  }
}

export interface InboxAccessInput {
  /** The caller's role in the organisation that owns the inbox. */
  organizationRole: string | null | undefined;
  /** Their explicit inbox membership, if any. */
  inboxRole: InboxRole | null | undefined;
}

/**
 * Resolve capabilities for one inbox.
 *
 * - No organisation membership at all → nothing, even if an `inbox_members` row
 *   exists (a removed colleague must not keep a mailbox).
 * - Organisation owner/admin → manager, so a workspace can always administer its
 *   own inboxes and cannot be locked out by an empty member list.
 * - Otherwise the inbox role decides; no row means no access.
 */
export function inboxCapabilities({
  organizationRole,
  inboxRole,
}: InboxAccessInput): InboxCapabilities {
  if (!organizationRole) return NONE;
  if (organizationRole === "owner" || organizationRole === "admin") return MANAGER;
  return capabilitiesForRole(inboxRole);
}

/** Convenience for guards that need one capability by name. */
export type InboxCapability = keyof InboxCapabilities;

export function can(access: InboxAccessInput, capability: InboxCapability): boolean {
  return inboxCapabilities(access)[capability];
}
