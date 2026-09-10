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
  "Marketing (don't, we're transactional-only)",
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

/** Profile-layer role options: who the human is. */
export const PROFILE_ROLES = [
  { value: "Developer", hint: "I build apps" },
  { value: "Founder", hint: "I build and manage a product" },
  { value: "Product / Engineering", hint: "I ship with a team" },
  { value: "Agency / Consultancy", hint: "I build for clients" },
  { value: "Student", hint: "I am learning" },
  { value: "Team / Company", hint: "Evaluating for us" },
  { value: "Other", hint: "Something else" },
] as const;

/** What they are building (multi-select, shapes project defaults). */
export const PROJECT_TYPES = [
  "SaaS / Web app",
  "Mobile app",
  "API / Backend",
  "AI application",
  "E-commerce",
  "Internal tool",
  "Agency projects",
  "Personal project",
  "Other",
] as const;

/** Why they came (single-select, personalizes what we emphasize). */
export const PRIMARY_GOALS = [
  "Send transactional email",
  "Set up OTP / verification",
  "Connect an existing email account",
  "Send from my own domain",
  "Replace my current email provider",
  "Explore Calder",
  "Build an integration",
  "Other",
] as const;

export const REFERRAL_SOURCES = [
  "Search",
  "X (Twitter)",
  "GitHub",
  "A friend",
  "Blog post",
  "Product Hunt",
  "Other",
] as const;

/** Discovery sources with an optional follow-up. */
export const DISCOVERY_SOURCES = [
  "X / Twitter",
  "LinkedIn",
  "GitHub",
  "YouTube",
  "TikTok",
  "Google / Search",
  "Friend or colleague",
  "AI assistant",
  "Product Hunt",
  "Blog / Article",
  "Developer community",
  "Other",
] as const;

export const AI_ASSISTANTS = ["ChatGPT", "Claude", "Gemini", "Cursor", "Other"] as const;

export type OnboardingState =
  "not_started" | "profile_in_progress" | "technical_in_progress" | "completed";

/** GitHub-style handles: lowercase alphanumerics + hyphens, max 39. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username);
}
