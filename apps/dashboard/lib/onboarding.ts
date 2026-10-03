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

/** A project or organization slug: lowercase alphanumeric + hyphens, 1–100 chars, no edge hyphens. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(slug);
}

export const ROLES = ["Developer", "Designer", "Founder", "Marketer", "Student", "Other"] as const;

/** Profile-layer role options: selectable cards on Screen 2 (Profile). */
export const PROFILE_ROLES = [
  { value: "Developer", label: "Developer", hint: "Building apps & APIs" },
  { value: "Founder", label: "Founder", hint: "Building & running a product" },
  { value: "Product / Engineering", label: "Product/Engineering", hint: "Shipping with a team" },
  { value: "Agency", label: "Agency", hint: "Building for clients" },
  { value: "Student", label: "Student", hint: "Learning & prototyping" },
  { value: "Team / Company", label: "Team/Company", hint: "Evaluating for an org" },
  { value: "Other", label: "Other", hint: "Another role" },
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

export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type OnboardingState =
  | "not_started"
  | "profile_in_progress"
  | "technical_in_progress"
  | "step_1"
  | "step_2"
  | "step_3"
  | "step_4"
  | "step_5"
  | "step_6"
  | "completed";

export const ONBOARDING_TOTAL_STEPS = 6;

export interface OnboardingPhase {
  id: "organization" | "sending" | "first-send";
  number: "01" | "02" | "03";
  title: string;
  shortTitle: string;
  summary: string;
  steps: readonly OnboardingStepNumber[];
}

/**
 * Three phases containing six screens — shown consistently on both the Welcome
 * preview and the top progress indicator.
 */
export const ONBOARDING_PHASES: readonly OnboardingPhase[] = [
  {
    id: "organization",
    number: "01",
    title: "Organization & project",
    shortTitle: "Organization",
    summary: "Your profile, workspace slug, and first application project.",
    steps: [1, 2, 3],
  },
  {
    id: "sending",
    number: "02",
    title: "Sending setup",
    shortTitle: "Sending",
    summary: "Start on the shared test sender, connect Gmail, or verify your domain.",
    steps: [4],
  },
  {
    id: "first-send",
    number: "03",
    title: "First send",
    shortTitle: "First send",
    summary: "Dispatch a real message and watch delivery confirm live.",
    steps: [5, 6],
  },
] as const;

export type SendingSetupMode = "shared" | "gmail" | "domain";

export interface SendingModeOption {
  id: SendingSetupMode;
  title: string;
  badge: string;
  recommended?: boolean;
  tradeoff: string;
}

export const SENDING_MODE_OPTIONS: readonly SendingModeOption[] = [
  {
    id: "shared",
    title: "Shared test sender",
    badge: "Fastest · Recommended",
    recommended: true,
    tradeoff:
      "Send immediately from welcome@calder.click with zero DNS or OAuth setup. Best for verifying your integration right now; recipients remain scoped to your test flow.",
  },
  {
    id: "gmail",
    title: "Use my Gmail",
    badge: "Google OAuth · 400/day",
    tradeoff:
      "Send from your own Gmail address via Google OAuth (gmail.send scope only, never passwords). No domain required, capped at 400 messages/day for development.",
  },
  {
    id: "domain",
    title: "Use my own domain",
    badge: "Production · Custom DNS",
    tradeoff:
      "Full production deliverability and custom sender addresses with SPF and DKIM signing. Requires publishing DNS records at your domain registrar.",
  },
] as const;

/** GitHub-style handles: lowercase alphanumerics + hyphens, max 39. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username);
}

/**
 * Compute phase status and fill percentage for the top progress indicator.
 */
export function getPhaseProgress(step: OnboardingStepNumber): Array<{
  phase: OnboardingPhase;
  status: "upcoming" | "active" | "complete";
  fillPercent: number;
}> {
  return ONBOARDING_PHASES.map((phase) => {
    const first = phase.steps[0]!;
    const last = phase.steps[phase.steps.length - 1]!;
    if (step > last) {
      return { phase, status: "complete" as const, fillPercent: 100 };
    }
    if (step < first) {
      return { phase, status: "upcoming" as const, fillPercent: 0 };
    }
    const idx = phase.steps.indexOf(step);
    const fillPercent = Math.round(((idx + 1) / phase.steps.length) * 100);
    return { phase, status: "active" as const, fillPercent };
  });
}

/**
 * Resolve which of the 6 screens a returning user should resume on based on
 * persisted backend state.
 */
export function resolveInitialOnboardingStep(input: {
  onboardingState?: string | null;
  hasUsername: boolean;
  hasOrg: boolean;
  hasProject: boolean;
  notice?: string | null;
}): OnboardingStepNumber {
  // Returning from Gmail OAuth callback always lands on Step 4 (Sending setup).
  if (
    input.notice === "gmail-ok" ||
    input.notice === "gmail-failed" ||
    input.notice?.startsWith("gmail-start:")
  ) {
    return input.hasOrg && input.hasProject ? 4 : input.hasUsername ? 3 : 2;
  }

  const raw = input.onboardingState ?? "not_started";
  const match = raw.match(/^step_([1-6])$/);
  if (match) {
    const saved = Number(match[1]) as OnboardingStepNumber;
    // Guard against impossible forward state if prerequisites were deleted.
    if (saved >= 3 && !input.hasUsername) return 2;
    if (saved >= 4 && (!input.hasOrg || !input.hasProject)) return 3;
    return saved;
  }

  if (raw === "profile_in_progress") {
    return input.hasUsername ? 3 : 2;
  }
  if (raw === "technical_in_progress" || raw === "in_progress") {
    if (!input.hasUsername) return 2;
    if (!input.hasOrg || !input.hasProject) return 3;
    return 4;
  }

  // Default progression from actual persisted entities if state is "not_started"
  if (input.hasUsername && input.hasOrg && input.hasProject) return 4;
  if (input.hasUsername) return 3;
  return 1;
}
