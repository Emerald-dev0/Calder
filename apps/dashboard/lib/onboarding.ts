/** Slugify org/project names: lowercase, hyphens, max 100 chars. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export const USE_CASES = [
  "OTP & verification",
  "Password resets",
  "Receipts & invoices",
  "Notifications",
  "Invitations",
  "Marketing (don't — we're transactional-only)",
] as const;

export type UseCase = (typeof USE_CASES)[number];

export const VOLUMES = ["< 1k / mo", "1k – 25k / mo", "25k – 100k / mo", "100k+ / mo"] as const;

export const ENVIRONMENTS = ["production", "staging", "development"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

/** A project is "live-ready" once it has a verified domain. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,100}$/.test(slug);
}

export const ROLES = ["Developer", "Designer", "Founder", "Marketer", "Student", "Other"] as const;

export const REFERRAL_SOURCES = [
  "Search",
  "X (Twitter)",
  "GitHub",
  "A friend",
  "Blog post",
  "Product Hunt",
  "Other",
] as const;

/** GitHub-style handles: lowercase alphanumerics + hyphens, max 39. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username);
}
