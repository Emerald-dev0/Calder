/**
 * Calder pricing, single source of truth for every public surface.
 *
 * Rules this file encodes (see docs/PRICING.md):
 * - ₦ and $ figures are Calder's own local prices, not live FX conversions.
 *   A Nigerian customer pays the naira price; a US customer pays the dollar
 *   price. Neither one moves when the exchange rate does.
 * - Nothing here is hardcoded anywhere else. Plan cards, the comparison
 *   table, FAQ answers, and structured data all read from this file.
 * - "In development" marks are maintained in the data for internal
 *   entitlement state, but the public page no longer displays them. The page
 *   sells one confident platform, not a roadmap.
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
    audience:
      "For personal projects, prototypes, early products, and developers getting their first application communication into production.",
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
      "Transactional email",
      "REST API",
      "SMTP relay",
      "Idempotency",
      "Signed webhooks",
      "2 sending domains",
      "5 sender identities",
      "3 projects",
      "Development environment",
      "Delivery logs",
      "Basic analytics",
      "7-day log retention",
      "Basic suppression and bounce handling",
      "Batch and scheduled sending",
      "1 team member",
    ],
    cta: "Start free",
    ctaHref: "/waitlist",
  },
  {
    id: "pro",
    name: "Pro",
    promise: "Ship with confidence.",
    audience: "For products moving beyond development and into real usage.",
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
      "Everything in Beginner, plus:",
      "Staging and production environments",
      "10 projects",
      "10 sending domains",
      "25 sender identities",
      "Scoped API keys",
      "Webhook replay",
      "Delivery trends",
      "Advanced delivery history",
      "Suppression and unsubscribe controls",
      "30-day log retention",
      "Queue visibility",
      "Rate-limit controls",
      "5 team members",
      "Roles and permissions",
      "Email support",
    ],
    cta: "Choose Pro",
    ctaHref: "/waitlist",
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
      "Everything in Pro, plus:",
      "50 projects",
      "50 sending domains",
      "Advanced deliverability monitoring",
      "Domain reputation visibility",
      "Custom rate limits",
      "Provider routing controls",
      "Custom throughput",
      "Advanced analytics",
      "90-day log retention",
      "Advanced roles",
      "Audit logs",
      "Security events",
      "IP allowlisting",
      "15 team members",
      "Priority support",
    ],
    cta: "Choose Premium",
    ctaHref: "/waitlist",
  },
  {
    id: "scale",
    name: "Scale",
    promise: "Make communication part of your infrastructure.",
    audience:
      "For organizations that need Calder shaped around their architecture, traffic, security, and operational requirements.",
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
      "Custom sending volume",
      "Dedicated infrastructure",
      "Dedicated IPs",
      "IP warmup",
      "Custom throughput",
      "Provider redundancy",
      "Advanced routing",
      "Custom retention",
      "SSO / SAML",
      "Advanced security controls",
      "SLA",
      "Architecture review",
      "Migration assistance",
      "Dedicated support",
      "Custom contracts and billing",
    ],
    cta: "Talk to Calder",
    ctaHref: "mailto:support@calder.click?subject=Calder%20Scale",
  },
];

/** One-line progression shown under the cards. See docs/PRICING.md § narrative. */
export const PROGRESSION = [
  { plan: "Beginner", line: "Build and experiment." },
  { plan: "Pro", line: "Ship and grow." },
  { plan: "Premium", line: "Operate at scale." },
  { plan: "Scale", line: "Make communication infrastructure." },
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
  { label: "Audiences", values: [YES, YES, YES, YES], status: "dev" },
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
    a: "One accepted send counts as one email. API reads, log queries, webhook deliveries, and test sends don't count toward your sending quota.",
  },
  {
    q: "What happens when I reach my limit?",
    a: "Sending pauses. The API returns a clear error showing the limit, your current usage, and when the quota resets. There are no automatic overage charges.",
  },
  {
    q: "Are the naira and dollar prices converted?",
    a: "No. ₦25,000 and $15 are intentionally separate prices for the same plan. They aren't tied to a daily exchange-rate calculation.",
  },
  {
    q: "Can I change plans?",
    a: "Yes. Upgrade or downgrade from your dashboard. Your projects, API keys, logs, and sending history stay with you.",
  },
  {
    q: "Do I need a domain to start?",
    a: "No. You can start development through Calder's supported onboarding path and move to a verified sending domain when you're ready for production sending.",
  },
  {
    q: "Are marketing capabilities included?",
    a: "Yes. Marketing communication is part of Calder's platform rather than a separate paid product. It uses its own contact allowance and operational boundaries.",
  },
];
