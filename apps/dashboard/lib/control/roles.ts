import type { platformRoleEnum } from "@calder/db";

/**
 * Control Plane role model.
 *
 * Two completely separate permission systems live side by side:
 *  - Platform roles (this file): what you may operate of CALDER itself.
 *  - Organization roles: what you may do inside one customer workspace.
 *
 * A founder is simultaneously a full platform operator and a normal
 * Calder customer; neither set of permissions implies or limits the other.
 *
 * `founder` is the apex role. It is the only role that can manage other
 * administrators, and it cannot be granted through any UI — only out-of-band
 * (seed / SQL / FOUNDER_EMAILS bootstrap env).
 */

export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];

/** Canonical test for the apex role — imported by both control actions files. */
export function isFounderRole(role: PlatformRole | null): boolean {
  return role === "founder";
}

export type ControlSection =
  | "overview"
  | "growth"
  | "customers"
  | "communications"
  | "billing"
  | "platform"
  | "infrastructure"
  | "observability"
  | "security"
  | "operations"
  | "administration";

export const ALL_SECTIONS: ControlSection[] = [
  "overview",
  "growth",
  "customers",
  "communications",
  "billing",
  "platform",
  "infrastructure",
  "observability",
  "security",
  "operations",
  "administration",
];

export const CONTROL_ROLE_LABEL: Record<PlatformRole, string> = {
  founder: "Founder",
  platform_admin: "Platform Admin",
  support: "Support Admin",
  billing: "Billing Admin",
  infrastructure: "Infrastructure Admin",
  security: "Security Admin",
  analyst: "Analyst",
};

/** Analyst = read-only. Everyone else is an operator within their sections. */
export const READ_ONLY_ROLES: PlatformRole[] = ["analyst"];

/**
 * Section visibility per role. Founder sees everything by definition
 * (ALL_SECTIONS). Kept explicit per role so the Administration → Roles
 * matrix renders from the same source of truth that enforcement uses.
 */
export const ROLE_SECTIONS: Record<PlatformRole, ControlSection[]> = {
  founder: ALL_SECTIONS,
  platform_admin: [
    "overview",
    "growth",
    "customers",
    "communications",
    "billing",
    "platform",
    "observability",
    "operations",
  ],
  support: ["overview", "customers", "communications"],
  billing: ["overview", "customers", "billing"],
  infrastructure: ["overview", "platform", "infrastructure", "observability"],
  security: ["overview", "customers", "security", "observability"],
  analyst: ["overview", "growth", "customers", "billing", "platform", "infrastructure"],
};

export function canAccessSection(role: PlatformRole, section: ControlSection): boolean {
  return ROLE_SECTIONS[role].includes(section);
}

/** Actions reserved to the founder regardless of any other role held. */
export const FOUNDER_ONLY_ACTIONS = [
  "Grant or revoke platform roles",
  "Change plan catalog pricing",
  "Change global limits and maintenance mode",
  "Configure email providers and routing",
  "Transfer platform ownership",
];

/**
 * Effective platform role for a user.
 *
 * Order matters: platform ownership always resolves — an explicit DB founder
 * role first, then the FOUNDER_EMAILS bootstrap (mirrors @calder/auth
 * ensureFounderAccess, so the founder can never lock themselves out of a
 * fresh environment, even if the DB row is missing). Non-founder DB roles
 * apply otherwise; everyone else is a normal customer.
 */
export function resolvePlatformRole(
  email: string,
  dbRole: PlatformRole | null,
  founderEmails: string | undefined
): PlatformRole | null {
  if (dbRole === "founder") return "founder";
  const list = (founderEmails ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.includes(email.toLowerCase())) return "founder";
  return dbRole;
}
