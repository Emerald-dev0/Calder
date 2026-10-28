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

import { PLAN_LIMITS, formatPlanPrice, type PlanTier } from "@calder/config/plan-limits";
import { SIGNUP_URL } from "./site";

export type Currency = "NGN" | "USD";
export type PlanId = "beginner" | "starter" | "pro" | "premium" | "scale";

/**
 * Marketing plan id → catalogue tier. The database still calls the entry tier
 * `free`; the name a customer reads is "Beginner" everywhere.
 */
const TIER_OF: Record<PlanId, PlanTier> = {
  beginner: "free",
  starter: "starter",
  pro: "pro",
  premium: "premium",
  scale: "scale",
};

const catalogue = (id: PlanId) => PLAN_LIMITS[TIER_OF[id]];

/** Limits are printed from the catalogue, never typed twice. */
function count(n: number | null): string {
  return n === null ? "Custom" : n.toLocaleString("en-US");
}

/** The price a customer pays, printed from the catalogue. */
export function planPrice(id: PlanId, currency: Currency): string {
  return formatPlanPrice(TIER_OF[id], currency);
}

const price = planPrice;

/** "5,000 emails, 3 projects, 2 domains" — the phrase docs and metadata use. */
export function planSummary(id: PlanId): string {
  const p = catalogue(id);
  return `${count(p.emailsPerMonth)} emails, ${count(p.projects)} projects, ${count(p.domains)} domains`;
}

function volumeText(id: PlanId): string {
  const n = catalogue(id).emailsPerMonth;
  return n === null ? "Custom volume" : `${count(n)} emails / month`;
}

function retentionText(id: PlanId): string {
  const d = catalogue(id).retentionDays;
  return d === null ? "Custom" : `${d} days`;
}

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
    price: { NGN: price("beginner", "NGN"), USD: price("beginner", "USD") },
    volume: volumeText("beginner"),
    volumeRaw: catalogue("beginner").emailsPerMonth,
    projects: count(catalogue("beginner").projects),
    domains: count(catalogue("beginner").domains),
    team: count(catalogue("beginner").seats),
    environments: "Development",
    logs: retentionText("beginner"),
    support: "Community",
    highlights: [
      "Transactional email",
      "REST API + SMTP relay",
      "Idempotency",
      "Signed webhooks",
      `${count(catalogue("beginner").domains)} sending domains`,
      `${count(catalogue("beginner").senders)} sender identities`,
      `${count(catalogue("beginner").projects)} projects`,
      "Development environment",
      "Delivery logs",
      "Basic analytics",
      `${retentionText("beginner")} log retention`,
      "Basic suppression and bounce handling",
      "Batch and scheduled sending",
      `${count(catalogue("beginner").seats)} team member`,
    ],
    cta: "Start free",
    ctaHref: SIGNUP_URL,
  },
  {
    id: "starter",
    name: "Starter",
    promise: "Start small, grow built-in.",
    audience:
      "For side projects and early-stage products ready to move beyond the free tier into a paid plan with higher quotas and more sending capacity.",
    price: { NGN: price("starter", "NGN"), USD: price("starter", "USD") },
    volume: volumeText("starter"),
    volumeRaw: catalogue("starter").emailsPerMonth,
    projects: count(catalogue("starter").projects),
    domains: count(catalogue("starter").domains),
    team: count(catalogue("starter").seats),
    environments: "Development",
    logs: retentionText("starter"),
    support: "Community",
    highlights: [
      "Everything in Beginner",
      "10,000 emails / month",
      "3 projects",
      "3 sending domains",
      "10 sender identities",
      "Scoped API keys",
      "Signed webhooks with retries",
      "Delivery trends",
      "Advanced delivery history",
      "Suppression and unsubscribe controls",
      "14 days log retention",
      "Batch and scheduled sending",
      `${count(catalogue("starter").seats)} team member`,
    ],
    cta: "Get started",
    ctaHref: SIGNUP_URL,
  },
  {
    id: "pro",
    name: "Pro",
    promise: "Ship with confidence.",
    audience: "For products moving beyond development and into real usage.",
    price: { NGN: price("pro", "NGN"), USD: price("pro", "USD") },
    volume: volumeText("pro"),
    volumeRaw: catalogue("pro").emailsPerMonth,
    projects: count(catalogue("pro").projects),
    domains: count(catalogue("pro").domains),
    team: count(catalogue("pro").seats),
    environments: "Dev · Staging · Production",
    logs: retentionText("pro"),
    support: "Email",
    highlights: [
      "Everything in Beginner",
      "Staging and production environments",
      `${count(catalogue("pro").projects)} projects`,
      `${count(catalogue("pro").domains)} sending domains`,
      `${count(catalogue("pro").senders)} sender identities`,
      "Scoped API keys",
      "Webhook replay",
      "Delivery trends",
      "Advanced delivery history",
      "Suppression and unsubscribe controls",
      `${retentionText("pro")} log retention`,
      "Queue visibility",
      "Rate-limit controls",
      `${count(catalogue("pro").seats)} team members`,
      "Roles and permissions",
      "Email support",
    ],
    cta: "Choose Pro",
    ctaHref: SIGNUP_URL,
    popular: true,
  },
  {
    id: "premium",
    name: "Premium",
    promise: "Operate with control.",
    audience:
      "For teams where communication is becoming part of the product infrastructure itself.",
    price: { NGN: price("premium", "NGN"), USD: price("premium", "USD") },
    volume: volumeText("premium"),
    volumeRaw: catalogue("premium").emailsPerMonth,
    projects: count(catalogue("premium").projects),
    domains: count(catalogue("premium").domains),
    team: count(catalogue("premium").seats),
    environments: "Dev · Staging · Production",
    logs: retentionText("premium"),
    support: "Priority",
    highlights: [
      "Everything in Pro",
      `${count(catalogue("premium").projects)} projects`,
      `${count(catalogue("premium").domains)} sending domains`,
      `${count(catalogue("premium").senders)} sender identities`,
      "Advanced deliverability monitoring",
      "Domain reputation visibility",
      "Custom rate limits",
      "Provider routing controls",
      "Custom throughput",
      "Advanced analytics",
      `${retentionText("premium")} log retention`,
      "Advanced roles",
      "Audit logs",
      "Security events",
      "IP allowlisting",
      `${count(catalogue("premium").seats)} team members`,
      "Priority support",
    ],
    cta: "Choose Premium",
    ctaHref: SIGNUP_URL,
  },
  {
    id: "scale",
    name: "Scale",
    promise: "Make communication part of your infrastructure.",
    audience:
      "For organizations that need Calder shaped around their architecture, traffic, security, and operational requirements.",
    price: { NGN: price("scale", "NGN"), USD: price("scale", "USD") },
    volume: volumeText("scale"),
    volumeRaw: catalogue("scale").emailsPerMonth,
    projects: count(catalogue("scale").projects),
    domains: count(catalogue("scale").domains),
    team: count(catalogue("scale").seats),
    environments: "Custom",
    logs: retentionText("scale"),
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
    ctaHref: "mailto:hello@calder.click?subject=Calder%20Scale",
  },
];

/** One-line progression shown under the cards. See docs/PRICING.md § narrative. */
export const PROGRESSION = [
  { plan: "Beginner", line: "Build and experiment." },
  { plan: "Starter", line: "Start small, grow built-in." },
  { plan: "Pro", line: "Ship and grow." },
  { plan: "Premium", line: "Operate at scale." },
  { plan: "Scale", line: "Make communication infrastructure." },
] as const;

export interface ComparisonRow {
  label: string;
  /** One value per plan, in PLANS order. */
  values: [string, string, string, string, string];
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

/** Comparison columns follow PLANS order: Beginner, Starter, Pro, Premium, Scale. */
function rowOf(pick: (id: PlanId) => string): [string, string, string, string, string] {
  return [pick("beginner"), pick("starter"), pick("pro"), pick("premium"), pick("scale")];
}

const projectsRow = () => rowOf((id) => count(catalogue(id).projects));
const domainsRow = () => rowOf((id) => count(catalogue(id).domains));
const sendersRow = () => rowOf((id) => count(catalogue(id).senders));
const seatsRow = () => rowOf((id) => count(catalogue(id).seats));

export const COMPARISON: ComparisonGroup[] = [
  {
    group: "Volume and sending",
    rows: [
      {
        label: "Emails per month",
        values: [
          count(catalogue("beginner").emailsPerMonth),
          count(catalogue("starter").emailsPerMonth),
          count(catalogue("pro").emailsPerMonth),
          count(catalogue("premium").emailsPerMonth),
          "Custom",
        ],
      },
      {
        label: "Transactional email",
        values: [YES, YES, YES, YES, YES],
        note: "OTPs, password resets, receipts, invoices, security alerts, order updates.",
      },
      {
        label: "Marketing email",
        values: [YES, YES, YES, YES, YES],
        status: "dev",
        note: "Newsletters, announcements, launches, promotions, lifecycle. Ships to every plan, no separate price.",
      },
      { label: "Projects", values: projectsRow() },
      { label: "Sending domains", values: domainsRow() },
      { label: "Sender identities", values: sendersRow() },
      {
        label: "Environments",
        values: ["Development", "Dev + Staging + Prod", "Dev + Staging + Prod", "Custom", "Custom"],
      },
      { label: "Batch sending (100 per call)", values: [YES, YES, YES, YES, YES] },
      {
        label: "Scheduled sending",
        values: [YES, YES, YES, YES, YES],
      },
    ],
  },
  {
    group: "Developer tools",
    rows: [
      {
        label: "REST API, versioned",
        values: [YES, YES, YES, YES, YES],
        note: "/v1, with a live OpenAPI document at api.calder.click/v1/openapi.json.",
      },
      { label: "SMTP relay", values: [YES, YES, YES, YES, YES] },
      { label: "Test and live API keys", values: [YES, YES, YES, YES, YES] },
      { label: "Scoped API keys", values: [NO, YES, YES, YES, YES] },
      { label: "Idempotency keys", values: [YES, YES, YES, YES, YES] },
      { label: "Signed webhooks with retries", values: [YES, YES, YES, YES, YES] },
      { label: "Webhook replay and delivery history", values: [NO, YES, YES, YES, YES] },
      {
        label: "SDKs and CLI",
        values: [YES, YES, YES, YES, YES],
        status: "dev",
        note: "The API is stable now; official packages follow the delivery core.",
      },
    ],
  },
  {
    group: "Reliability and control",
    status: "today",
    rows: [
      { label: "Automatic retries with backoff", values: [YES, YES, YES, YES, YES] },
      { label: "Suppression and bounce handling", values: [YES, YES, YES, YES, YES] },
      { label: "Queue visibility", values: [NO, YES, YES, YES, YES] },
      { label: "Rate-limit controls", values: [NO, YES, YES, YES, YES] },
      { label: "Custom throughput", values: [NO, NO, YES, YES, YES] },
      {
        label: "Provider routing and fallback",
        values: [NO, NO, YES, YES, YES],
        status: "dev",
        note: "SES is the delivery provider today; additional providers sit behind the same interface.",
      },
      { label: "Dedicated IPs and warmup", values: [NO, NO, NO, YES, YES] },
      { label: "SLA", values: [NO, NO, NO, YES, YES] },
    ],
  },
  {
    group: "Observability",
    rows: [
      {
        label: "Log retention",
        values: [
          retentionText("beginner"),
          retentionText("starter"),
          retentionText("pro"),
          retentionText("premium"),
          "Custom",
        ],
      },
      { label: "Delivery, bounce and failure status", values: [YES, YES, YES, YES, YES] },
      { label: "Basic analytics", values: [YES, YES, YES, YES, YES] },
      {
        label: "Advanced analytics: trends, failure analysis",
        values: [NO, YES, YES, YES, YES],
        status: "dev",
      },
      {
        label: "Deliverability monitoring, domain reputation",
        values: [NO, NO, YES, YES, YES],
        status: "dev",
      },
      { label: "Custom dashboards and alerts", values: [NO, NO, YES, YES, YES], status: "dev" },
    ],
  },
  {
    group: "Team, security and support",
    rows: [
      { label: "Team members", values: seatsRow() },
      { label: "Roles and permissions", values: [NO, "Basic", "Advanced", "Custom", "Custom"] },
      { label: "Organization activity", values: [NO, YES, YES, YES, YES], status: "dev" },
      { label: "Audit logs and security events", values: [NO, NO, YES, YES, YES], status: "dev" },
      { label: "IP allowlisting", values: [NO, NO, YES, YES, YES], status: "dev" },
      { label: "SSO / SAML", values: [NO, NO, NO, YES, YES], status: "dev" },
      { label: "Support", values: ["Community", "Email", "Priority", "Dedicated", "Dedicated"] },
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
  // Draft figures, deliberately NOT sourced from the plan catalogue: the
  // contacts allowance is unapproved and must not gain authority by moving.
  { label: "Contacts", values: ["1,000", "10,000", "50,000", "Custom", "Custom"] },
  { label: "Campaigns", values: [YES, YES, YES, YES, YES] },
  { label: "Audiences", values: [YES, YES, YES, YES, YES] },
  { label: "Segments", values: ["Basic", YES, "Advanced", "Custom", "Custom"] },
  { label: "Automations", values: ["Basic", YES, "Advanced", "Custom", "Custom"] },
  { label: "Marketing analytics", values: ["Basic", "Advanced", "Advanced", "Custom", "Custom"] },
  { label: "Unsubscribe handling", values: [YES, YES, YES, YES, YES] },
  { label: "Suppression", values: [YES, YES, "Advanced", "Advanced", "Advanced"] },
  { label: "Preference center", values: [NO, YES, YES, YES, YES] },
  { label: "Sending schedule", values: [YES, YES, YES, YES, YES] },
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
    a: `No. ${price("pro", "NGN")} and ${price("pro", "USD")} are intentionally separate prices for the same plan. They aren't tied to a daily exchange-rate calculation.`,
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
