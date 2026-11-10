/**
 * Calder pricing, single source of truth for every public surface.
 *
 * Rules this file encodes (see docs/PRICING.md):
 * - ₦ and $ figures are Calder's own local prices, not live FX conversions.
 *   A Nigerian customer pays the naira price; a US customer pays the dollar
 *   price. Neither one moves when the exchange rate does.
 * - Exactly three plans are sold: Beginner, Starter and Pro. Premium and Scale
 *   are retired from the commercial catalogue; their historical subscriptions
 *   are unaffected and are resolved by `@calder/config/plan-limits`, never by
 *   this marketing file.
 * - Nothing here is hardcoded anywhere else. Plan cards, the comparison
 *   table, FAQ answers and structured data all read from this file.
 * - Only implemented capability is printed as included. Anything planned is
 *   rendered separately and tagged Coming soon. We do not advertise log
 *   retention periods (no purge exists), environment restrictions (not
 *   enforced), key-scope tiering (not enforced) or webhook replay as a paid
 *   differentiator (available to everyone).
 */

import { PLAN_LIMITS, formatPlanPrice, type PlanTier } from "@calder/config/plan-limits";
import { CREDIT_PACKS, DAILY_BURST_PASS, formatUsdCents } from "@calder/config";
import { SIGNUP_URL } from "./site";

export type Currency = "NGN" | "USD";
export type PlanId = "beginner" | "starter" | "pro";

/**
 * Marketing plan id → catalogue tier. The database still calls the entry tier
 * `free`; the name a customer reads is "Beginner" everywhere.
 */
const TIER_OF: Record<PlanId, PlanTier> = {
  beginner: "free",
  starter: "starter",
  pro: "pro",
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

/**
 * Honest status for anything that is not simply available today.
 *
 * `soon` is the MVP boundary: the capability is not in this release and is not
 * usable. `today` is the default and is not rendered.
 */
export type Status = "today" | "soon";

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
  /** Daily submission ceiling, already formatted ("500 / day"). */
  daily: string;
  volumeRaw: number | null;
  projects: string;
  domains: string;
  team: string;
  /** Short scannable list on the card itself — capabilities usable today. */
  highlights: string[];
  /**
   * Advertised capabilities that are not implemented. Rendered separately and
   * tagged "Coming soon"; never mixed into the available list.
   */
  plannedHighlights?: string[];
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
    daily: `${count(catalogue("beginner").dailySendCap)} / day`,
    projects: count(catalogue("beginner").projects),
    domains: count(catalogue("beginner").domains),
    team: count(catalogue("beginner").seats),
    highlights: [
      "Transactional email",
      "REST API",
      "Idempotency",
      "Scoped API keys",
      "Signed webhooks",
      `${count(catalogue("beginner").domains)} sending domains`,
      `${count(catalogue("beginner").senders)} sender identities`,
      `${count(catalogue("beginner").projects)} projects`,
      "Delivery logs",
      "Basic analytics",
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
      "For side projects and early-stage products ready to move beyond the free tier into higher quotas and more sending capacity.",
    price: { NGN: price("starter", "NGN"), USD: price("starter", "USD") },
    volume: volumeText("starter"),
    volumeRaw: catalogue("starter").emailsPerMonth,
    daily: `${count(catalogue("starter").dailySendCap)} / day`,
    projects: count(catalogue("starter").projects),
    domains: count(catalogue("starter").domains),
    team: count(catalogue("starter").seats),
    highlights: [
      "Everything in Beginner",
      "10,000 emails / month",
      "3 projects",
      "3 sending domains",
      "10 sender identities",
      "Signed webhooks with retries",
      "Delivery trends",
      "Advanced delivery history",
      "Suppression and unsubscribe controls",
      "Batch and scheduled sending",
      `${count(catalogue("starter").seats)} team members`,
    ],
    cta: "Choose Starter",
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
    daily: `${count(catalogue("pro").dailySendCap)} / day`,
    projects: count(catalogue("pro").projects),
    domains: count(catalogue("pro").domains),
    team: count(catalogue("pro").seats),
    highlights: [
      "Everything in Starter",
      "50,000 emails / month",
      `${count(catalogue("pro").projects)} projects`,
      `${count(catalogue("pro").domains)} sending domains`,
      `${count(catalogue("pro").senders)} sender identities`,
      "Signed webhooks with retries",
      "Delivery trends",
      "Advanced delivery history",
      "Suppression and unsubscribe controls",
      `${count(catalogue("pro").seats)} team members`,
      "Email support",
    ],
    plannedHighlights: ["Queue visibility", "Rate-limit controls", "Roles and permissions"],
    cta: "Choose Pro",
    ctaHref: SIGNUP_URL,
    popular: true,
  },
];

/** One-line progression shown under the cards. See docs/PRICING.md § narrative. */
export const PROGRESSION = [
  { plan: "Beginner", line: "Build and experiment." },
  { plan: "Starter", line: "Start small, grow built-in." },
  { plan: "Pro", line: "Ship and grow." },
] as const;

export interface ComparisonRow {
  label: string;
  /** One value per plan, in PLANS order: Beginner, Starter, Pro. */
  values: [string, string, string];
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
const SOON = "Coming soon";

/** Comparison columns follow PLANS order: Beginner, Starter, Pro. */
function rowOf(pick: (id: PlanId) => string): [string, string, string] {
  return [pick("beginner"), pick("starter"), pick("pro")];
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
        ],
      },
      {
        label: "Transactional email",
        values: [YES, YES, YES],
        note: "OTPs, password resets, receipts, invoices, security alerts, order updates.",
      },
      {
        label: "Marketing email",
        values: [SOON, SOON, SOON],
        status: "soon",
        note: "Broadcasts, audiences and campaigns exist in the codebase but are not part of this release. The API is disabled and the dashboard shows Coming Soon.",
      },
      { label: "Projects", values: projectsRow() },
      { label: "Sending domains", values: domainsRow() },
      { label: "Sender identities", values: sendersRow() },
      { label: "Batch sending (100 per call)", values: [YES, YES, YES] },
      { label: "Scheduled sending", values: [YES, YES, YES] },
    ],
  },
  {
    group: "Developer tools",
    rows: [
      {
        label: "REST API, versioned",
        values: [YES, YES, YES],
        note: "/v1, with a live OpenAPI document at api.calder.click/v1/openapi.json.",
      },
      {
        label: "Test and live API keys",
        values: [YES, YES, YES],
        note: "Available on every plan. A test key simulates delivery and is never metered.",
      },
      {
        label: "Scoped API keys",
        values: [YES, YES, YES],
        note: "full / manage / send / read, on every plan. Not tier-restricted.",
      },
      { label: "Idempotency keys", values: [YES, YES, YES] },
      { label: "Signed webhooks with retries", values: [YES, YES, YES] },
      {
        label: "Webhook replay and delivery history",
        values: [YES, YES, YES],
        note: "Available on every plan today; not a paid differentiator.",
      },
      {
        label: "SDKs",
        values: ["Node, Python", "Node, Python", "Node, Python"],
        note: "Source and tests only; packages are not published yet. Ruby/PHP are unverified.",
      },
      { label: "Support", values: ["Community", "Email", "Email"] },
    ],
  },
  {
    group: "Reliability and platform",
    rows: [
      { label: "Automatic retries with backoff", values: [YES, YES, YES] },
      { label: "Suppression and bounce handling", values: [YES, YES, YES] },
      { label: "Delivery, bounce and failure status", values: [YES, YES, YES] },
      { label: "Basic analytics", values: [YES, YES, YES] },
      {
        label: "Team members",
        values: seatsRow(),
      },
      {
        label: "Roles and permissions",
        values: [YES, YES, YES],
        note: "Owner / admin / member, on every plan.",
      },
      {
        label: "Audit logs and security events",
        values: [YES, YES, YES],
        note: "Available on every plan today; not a paid differentiator.",
      },
      { label: "Queue visibility", values: [SOON, SOON, SOON], status: "soon" },
      { label: "Rate-limit controls", values: [SOON, SOON, SOON], status: "soon" },
      { label: "Custom throughput", values: [SOON, SOON, SOON], status: "soon" },
      { label: "Provider routing and fallback", values: [SOON, SOON, SOON], status: "soon" },
      { label: "Dedicated IPs and warmup", values: [SOON, SOON, SOON], status: "soon" },
      { label: "SLA", values: [SOON, SOON, SOON], status: "soon" },
      {
        label: "Advanced analytics: trends, failure analysis",
        values: [SOON, SOON, SOON],
        status: "soon",
      },
      {
        label: "Deliverability monitoring, domain reputation",
        values: [SOON, SOON, SOON],
        status: "soon",
      },
      { label: "Custom dashboards and alerts", values: [SOON, SOON, SOON], status: "soon" },
      { label: "IP allowlisting", values: [SOON, SOON, SOON], status: "soon" },
      { label: "SSO / SAML", values: [SOON, SOON, SOON], status: "soon" },
    ],
  },
];

/**
 * Marketing allowances. Kept separate from sending volume on purpose: a
 * customer's OTP budget must not be eaten by campaigns, and campaign
 * reputation should never sit next to application mail. See PRD §18.
 */
export const MARKETING_ALLOWANCES: ComparisonRow[] = [
  // The whole marketing suite is out of scope for this release. These rows are
  // kept so the planned shape is visible, but every value says so instead of
  // printing a checkmark for a product that cannot be used.
  ...(
    [
      "Contacts",
      "Campaigns",
      "Audiences",
      "Segments",
      "Automations",
      "Marketing analytics",
      "Preference center",
      "Campaign unsubscribe management",
      "Marketing sending schedule",
    ] as const
  ).map((label) => ({
    label,
    values: [SOON, SOON, SOON] as [string, string, string],
    status: "soon" as const,
  })),
  {
    label: "Transactional suppression and unsubscribe",
    values: [YES, YES, YES],
    note: "Part of the email MVP and live today. Distinct from campaign unsubscribe management.",
  },
];

/**
 * Prepaid capacity offers. Prices and quantities come from the same catalogue
 * the API uses to charge and credit accounts, never from this file.
 */
export const CREDIT_OFFERS = CREDIT_PACKS.map((pack) => ({
  id: pack.id,
  name: pack.name,
  price: formatUsdCents(pack.amountCents),
  credits: pack.credits.toLocaleString("en-US"),
  cta: `Buy ${pack.credits.toLocaleString("en-US")} credits`,
  ctaHref: `${SIGNUP_URL}?intent=credits&pack=${pack.id}`,
}));

export const BURST_OFFER = {
  price: formatUsdCents(DAILY_BURST_PASS.amountCents),
  capacity: DAILY_BURST_PASS.additionalCapacity.toLocaleString("en-US"),
  maxPerDay: DAILY_BURST_PASS.maxPerUtcDay,
  cta: "Get a Daily Burst Pass",
  ctaHref: `${SIGNUP_URL}?intent=burst_pass`,
};

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
    q: "What currency am I charged in?",
    a: "US dollars. Prices are fixed USD amounts, not currency conversions. If USD payments are not enabled on our Paystack merchant account, checkout refuses rather than charging you in another currency.",
  },
  {
    q: "What are monthly credits?",
    a: "Prepaid packs you buy once and use after your included monthly allowance is exhausted. They carry forward and each purchase expires 12 months after you buy it. Credits never extend your daily limit.",
  },
  {
    q: "What is a Daily Burst Pass?",
    a: `A ${BURST_OFFER.price} one-time purchase that adds ${BURST_OFFER.capacity} submissions for the rest of the current UTC day. It expires at 23:59:59 UTC, does not roll over, does not add monthly credits, and is capped at ${BURST_OFFER.maxPerDay} per account per UTC day.`,
  },
  {
    q: "What happened to Premium and Scale?",
    a: "They are retired from the commercial catalogue. Existing subscriptions on those plans keep their current limits and are not downgraded; they simply cannot be newly purchased or assigned. Beginner, Starter and Pro are the plans on offer.",
  },
  {
    q: "Can I change plans?",
    a: "Yes. Starter and Pro are monthly subscriptions billed in USD through Paystack. Cancelling stops the next renewal; your data is never deleted and your account moves to the Beginner limits when the paid period ends.",
  },
  {
    q: "Do I need a domain to start?",
    a: "No. You can start development through Calder's supported onboarding path and move to a verified sending domain when you're ready for production sending.",
  },
  {
    q: "Are marketing capabilities included?",
    a: "Not in this release. Broadcasts, campaigns and audiences are planned but not available: the API refuses them and the dashboard labels them Coming Soon. Transactional unsubscribe and suppression are live because email compliance requires them.",
  },
];
