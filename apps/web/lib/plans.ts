/**
 * Calder pricing, single source of truth for every public surface.
 *
 * Rules this file encodes (see docs/PRICING.md):
 * - ₦ and $ figures are Calder's own local prices, not live FX conversions.
 *   A Nigerian customer pays the naira price; a US customer pays the dollar
 *   price. Neither one moves when the exchange rate does.
 * - Nothing here is hardcoded anywhere else. Plan cards, the comparison
 *   table, FAQ answers, and structured data all read from this file.
 * - "In development" marks are deliberately visible. The marketing suite and
 *   a few control features are not built yet, and a pricing page that hides
 *   that is selling something it cannot deliver.
 */

export type Currency = "NGN" | "USD";
export type PlanId = "beginner" | "pro" | "premium" | "scale";

/** Honest status for anything that is not simply available today. */
export type Status = "today" | "dev";

export interface Plan {
  id: PlanId;
  name: string;
  /** The one-line promise, used under each card. */
  promise: string;
  /** Who the plan is for, in plain words. */
  audience: string;
  price: { NGN: string; USD: string };
  /** Emails per month, already formatted. */
  volume: string;
  volumeRaw: number | null;
  projects: string;
  domains: string;
  team: string;
  environments: string;
  logs: string;
  support: string;
  /** Short scannable list on the card itself. */
  highlights: string[];
  cta: string;
  ctaHref: string;
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "beginner",
    name: "Beginner",
    promise: "Build without worrying about the bill.",
    audience: "Students, side projects, and your first production users.",
    price: { NGN: "₦0", USD: "$0" },
    volume: "5,000 emails / month",
    volumeRaw: 5000,
    projects: "3",
    domains: "2",
    team: "1",
    environments: "Development",
    logs: "7 days",
    support: "Community",
    highlights: [
      "Transactional email — OTPs, receipts, resets, alerts",
      "REST API, SMTP relay, idempotency, signed webhooks",
      "2 sending domains with SPF, DKIM and DMARC checks",
      "Delivery logs and basic analytics",
      "3 projects, development environment only",
    ],
    cta: "Start free",
    ctaHref: "https://app.calder.click/signup",
  },
  {
    id: "pro",
    name: "Pro",
    promise: "Ship with confidence.",
    audience: "Developers and small teams running real products.",
    price: { NGN: "₦25,000", USD: "$15" },
    volume: "50,000 emails / month",
    volumeRaw: 50000,
    projects: "10",
    domains: "10",
    team: "5",
    environments: "Dev + Staging + Production",
    logs: "30 days",
    support: "Email",
    highlights: [
      "Everything in Beginner, at 10× the volume",
      "Development, staging and production environments",
      "25 sender identities, scoped API keys",
      "Webhook replay and delivery trends",
      "Suppression, unsubscribe and bounce handling",
      "5 team members with basic roles",
    ],
    cta: "Choose Pro",
    ctaHref: "https://app.calder.click/signup?plan=pro",
    popular: true,
  },
  {
    id: "premium",
    name: "Premium",
    promise: "Operate with control.",
    audience: "Growing companies where email is business-critical.",
    price: { NGN: "₦75,000", USD: "$49" },
    volume: "250,000 emails / month",
    volumeRaw: 250000,
    projects: "50",
    domains: "50",
    team: "15",
    environments: "Dev + Staging + Production",
    logs: "90 days",
    support: "Priority",
    highlights: [
      "Everything in Pro, plus delivery at scale",
      "Deliverability monitoring and domain reputation",
      "Custom rate limits and provider routing controls",
      "Advanced roles, audit logs, security events",
      "15 team members with organization controls",
      "Priority support from the people who built it",
    ],
    cta: "Choose Premium",
    ctaHref: "https://app.calder.click/signup?plan=premium",
  },
  {
    id: "scale",
    name: "Scale",
    promise: "Make communication part of your infrastructure.",
    audience: "Companies where delivery is mission-critical.",
    price: { NGN: "Custom", USD: "Custom" },
    volume: "Custom volume",
    volumeRaw: null,
    projects: "Custom",
    domains: "Custom",
    team: "Custom",
    environments: "Custom",
    logs: "Custom",
    support: "Dedicated",
    highlights: [
      "Dedicated IPs with warmup and custom routing",
      "Custom throughput, redundancy and delivery architecture",
      "SLA with priority incident response",
      "SSO/SAML, advanced security controls, custom retention",
      "Architecture review and migration assistance",
      "Invoicing and custom commercial terms",
    ],
    cta: "Talk to Calder",
    ctaHref: "mailto:support@calder.click?subject=Calder%20Scale",
  },
];

/** One-line progression shown under the cards. See docs/PRICING.md § narrative. */
export const PROGRESSION = [
  { plan: "Beginner", line: "I can build." },
  { plan: "Pro", line: "I can ship." },
  { plan: "Premium", line: "I can operate." },
  { plan: "Scale", line: "I can depend on this." },
] as const;

export interface ComparisonRow {
  label: string;
  /** Four values in PLANS order. */
  values: [string, string, string, string];
  status?: Status;
  note?: string;
}

export interface ComparisonGroup {
  group: string;
  description?: string;
  status?: Status;
  rows: ComparisonRow[];
}

const YES = "✓";
const NO = "—";

export const COMPARISON: ComparisonGroup[] = [
  {
    group: "Volume and sending",
    rows: [
      {
        label: "Emails per month",
        values: ["5,000", "50,000", "250,000", "Custom"],
      },
      {
        label: "Transactional email",
        values: [YES, YES, YES, YES],
        note: "OTPs, password resets, receipts, invoices, security alerts, order updates.",
      },
      {
        label: "Marketing email",
        values: [YES, YES, YES, YES],
        status: "dev",
        note: "Newsletters, announcements, launches, promotions, lifecycle. Ships to every plan, no separate price.",
      },
      { label: "Projects", values: ["3", "10", "50", "Custom"] },
      { label: "Sending domains", values: ["2", "10", "50", "Custom"] },
      { label: "Sender identities", values: ["5", "25", "50", "Custom"] },
      {
        label: "Environments",
        values: ["Development", "Dev + Staging + Prod", "Dev + Staging + Prod", "Custom"],
      },
      { label: "Batch sending (100 per call)", values: [YES, YES, YES, YES] },
      {
        label: "Scheduled sending",
        values: [YES, YES, YES, YES],
      },
    ],
  },
  {
    group: "Developer tools",
    rows: [
      {
        label: "REST API, versioned",
        values: [YES, YES, YES, YES],
        note: "/v1, with a live OpenAPI document at api.calder.click/v1/openapi.json.",
      },
      { label: "SMTP relay", values: [YES, YES, YES, YES] },
      { label: "Test and live API keys", values: [YES, YES, YES, YES] },
      { label: "Scoped API keys", values: [NO, YES, YES, YES] },
      { label: "Idempotency keys", values: [YES, YES, YES, YES] },
      { label: "Signed webhooks with retries", values: [YES, YES, YES, YES] },
      { label: "Webhook replay and delivery history", values: [NO, YES, YES, YES] },
      {
        label: "SDKs and CLI",
        values: [YES, YES, YES, YES],
        status: "dev",
        note: "The API is stable now; official packages follow the delivery core.",
      },
    ],
  },
  {
    group: "Reliability and control",
    status: "today",
    rows: [
      { label: "Automatic retries with backoff", values: [YES, YES, YES, YES] },
      { label: "Suppression and bounce handling", values: [YES, YES, YES, YES] },
      { label: "Queue visibility", values: [NO, YES, YES, YES] },
      { label: "Rate-limit controls", values: [NO, YES, YES, YES] },
      { label: "Custom throughput", values: [NO, NO, YES, YES] },
      {
        label: "Provider routing and fallback",
        values: [NO, NO, YES, YES],
        status: "dev",
        note: "SES is the delivery provider today; additional providers sit behind the same interface.",
      },
      { label: "Dedicated IPs and warmup", values: [NO, NO, NO, YES] },
      { label: "SLA", values: [NO, NO, NO, YES] },
    ],
  },
  {
    group: "Observability",
    rows: [
      {
        label: "Log retention",
        values: ["7 days", "30 days", "90 days", "Custom"],
      },
      { label: "Delivery, bounce and failure status", values: [YES, YES, YES, YES] },
      { label: "Basic analytics", values: [YES, YES, YES, YES] },
      {
        label: "Advanced analytics: trends, failure analysis",
        values: [NO, YES, YES, YES],
        status: "dev",
      },
      {
        label: "Deliverability monitoring, domain reputation",
        values: [NO, NO, YES, YES],
        status: "dev",
      },
      { label: "Custom dashboards and alerts", values: [NO, NO, YES, YES], status: "dev" },
    ],
  },
  {
    group: "Team, security and support",
    rows: [
      { label: "Team members", values: ["1", "5", "15", "Custom"] },
      { label: "Roles and permissions", values: [NO, "Basic", "Advanced", "Custom"] },
      { label: "Organization activity", values: [NO, YES, YES, YES], status: "dev" },
      { label: "Audit logs and security events", values: [NO, NO, YES, YES], status: "dev" },
      { label: "IP allowlisting", values: [NO, NO, YES, YES], status: "dev" },
      { label: "SSO / SAML", values: [NO, NO, NO, YES], status: "dev" },
      { label: "Support", values: ["Community", "Email", "Priority", "Dedicated"] },
    ],
  },
];

/**
 * Marketing allowances. Kept separate from sending volume on purpose: a
 * customer with a 50,000-contact list should not have their OTP budget eaten
 * by campaigns, and campaign reputation should never sit next to application
 * mail. See PRD §18.
 */
export const MARKETING_ALLOWANCES: ComparisonRow[] = [
  { label: "Contacts", values: ["1,000", "10,000", "50,000", "Custom"] },
  { label: "Campaigns", values: [YES, YES, YES, YES], status: "dev" },
  {
    label: "Templates",
    values: ["Basic", "Advanced", "Advanced", "Custom"],
  },
  { label: "Automations", values: ["Basic", YES, "Advanced", "Custom"], status: "dev" },
  { label: "Segments", values: ["Basic", YES, "Advanced", "Custom"], status: "dev" },
  { label: "Analytics", values: ["Basic", "Advanced", "Advanced", "Custom"], status: "dev" },
  { label: "Unsubscribe handling", values: [YES, YES, YES, YES] },
  {
    label: "Suppression",
    values: [YES, YES, "Advanced", "Advanced"],
  },
  { label: "Sending schedule", values: [YES, YES, YES, YES] },
  { label: "Preference center", values: [NO, YES, YES, YES], status: "dev" },
];

/** Plain-language answers. Short, specific, no hedging. */
export const PRICING_FAQS: Array<{ q: string; a: string }> = [
  {
    q: "What counts as an email?",
    a: "One accepted send, the 202 you get back from POST /v1/emails. API reads, webhook deliveries and log queries are never metered. Neither are test sends: test keys run the whole pipeline without delivering anything.",
  },
  {
    q: "Are the naira and dollar prices converted?",
    a: "No. ₦25,000 and $15 are separate prices for the same plan, decided by us, not by an exchange rate that moves every morning. Nigerian customers pay in naira, with local payment rails, at a naira price that stays put.",
  },
  {
    q: "What happens when I reach my limit?",
    a: "Sending pauses with a clear error that names your limit, your usage, and when it resets. We do not auto-charge overages and we do not silently drop mail. You will always know before your bill changes.",
  },
  {
    q: "Is the marketing suite really included at ₦0?",
    a: "Yes. Campaigns, audiences, automations and the preference center ship to every plan, including Beginner, with contact limits instead of a separate product line. It is in development today, and your plan includes it when it lands, at no additional cost.",
  },
  {
    q: "Why does transactional email get its own stream?",
    a: "Because an OTP and a newsletter should not share a reputation. Campaigns live on their own stream with their own suppression and consent state, so a rough week of marketing never becomes a broken login for your users.",
  },
  {
    q: "Do I need a domain to start?",
    a: "No. Connect a Gmail account through Google's own authorization and send through the same API, capped and clearly labeled. When you are ready to send at volume, verify a domain and your code does not change.",
  },
  {
    q: "Can I move between plans?",
    a: "Any time, in both directions, from the dashboard. Changing plans never changes your API keys, your logs or your sending history.",
  },
];
