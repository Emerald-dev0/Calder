/**
 * Feature availability registry — the single place that answers "does this
 * feature exist, is it in the MVP, and can this customer use it?".
 *
 * Before this file, availability was scattered: the sidebar hardcoded a `PRO`
 * badge, broadcast pages assumed the marketing suite existed, an Inbox page
 * advertised inbound email that has no implementation, and the public pricing
 * page advertised capability that was never built. Each surface made its own
 * guess, so they disagreed.
 *
 * Three different questions must never be collapsed into one:
 *
 *  1. **Does the feature exist?**     `status === "ready"` means the end-to-end
 *     journey is implemented and tested. `coming_soon` means it is planned but
 *     not usable; `not_supported` means it is not in the product scope.
 *  2. **Is it in the MVP?**          `mvp` is a scope decision, independent of
 *     implementation. Marketing/broadcasts are implemented in code but
 *     **not** in the MVP, so they stay `coming_soon` regardless.
 *  3. **Does this plan include it?**  `plans` is a commercial entitlement.
 *     Every implemented feature is currently available on every tier because
 *     no paid tier can be assigned while billing is off; the resource and
 *     email ceilings in `plan-limits.ts` are the entitlements that *are*
 *     enforced. See `docs/MVP-FEATURE-MATRIX.md`.
 *
 * `available` is only true when a feature is ready *and* entitled. A UI must
 * never enable an interaction based on `status` alone, and the API must never
 * accept a request for a feature that is not `ready` — hiding navigation is
 * not a security control.
 */

import { PLAN_LIMITS, PLAN_ORDER, type PlanTier, isExemptTier } from "./plan-limits.js";

export type FeatureStatus =
  /** Implemented end-to-end and tested. Safe to expose. */
  | "ready"
  /** Planned, visible as Coming Soon, never executable. */
  | "coming_soon"
  /** Not part of the product scope. Do not add UI for it. */
  | "not_supported";

export type FeatureId =
  // Core email infrastructure
  | "transactional_email"
  | "email_api"
  | "email_delivery_pipeline"
  | "email_templates"
  | "sender_identities"
  | "domains"
  | "domain_verification"
  | "dkim"
  | "spf"
  | "dmarc"
  | "delivery_tracking"
  | "delivery_logs"
  | "suppression_management"
  | "bounce_handling"
  | "complaint_handling"
  | "unsubscribe_handling"
  | "idempotency"
  | "sending_limits"
  | "sandbox_environment"
  | "email_scheduling"
  | "batch_sending"
  // Developer tools
  | "api_keys"
  | "api_key_revocation"
  | "api_key_expiration"
  | "api_documentation"
  | "sdk_node"
  | "sdk_python"
  | "sdk_ruby"
  | "sdk_php"
  | "cli"
  | "webhooks"
  | "webhook_logs"
  | "webhook_replay"
  | "smtp_gateway"
  | "inbound_email"
  | "gmail_integration"
  // Workspace
  | "workspace_overview"
  | "projects"
  | "environments"
  | "team_management"
  | "organization_settings"
  | "usage_overview"
  | "audit_logs"
  | "integrations"
  // Observability
  | "basic_usage_analytics"
  | "email_volume_tracking"
  | "bounce_statistics"
  | "complaint_statistics"
  | "delivery_trends"
  | "advanced_analytics"
  | "usage_forecasting"
  | "uptime_status"
  | "platform_incidents"
  | "customer_uptime_history"
  // Marketing (not MVP)
  | "marketing_overview"
  | "broadcasts"
  | "campaigns"
  | "audiences"
  | "contacts"
  | "segments"
  | "marketing_automations"
  | "marketing_templates"
  | "campaign_analytics"
  | "marketing_unsubscribes";

/** Where a customer meets a feature, so surfaces cannot invent their own map. */
export interface FeatureSurfaces {
  dashboardHref?: string;
  apiRoutes?: readonly string[];
  marketing?: boolean;
}

export interface FeatureDefinition {
  id: FeatureId;
  /** The customer-facing name. The only name a surface may print. */
  name: string;
  status: FeatureStatus;
  /** Included in the current MVP scope. Independent of `status`. */
  mvp: boolean;
  /** Tiers whose plan includes it. Default: every tier. */
  plans?: readonly PlanTier[];
  surfaces?: FeatureSurfaces;
  /** Customer-safe explanation. Required for anything not `ready`. */
  note?: string;
  /** What must happen before it can become `ready`. Internal, honest. */
  blocker?: string;
  /** Owner is a person/role; never a vague "team". */
  ownerAction?: string;
}

const ALL_TIERS: readonly PlanTier[] = PLAN_ORDER;

/**
 * The inventory. Order mirrors `docs/MVP-FEATURE-MATRIX.md` so the document
 * and this registry can be reviewed together.
 */
export const FEATURES: Readonly<Record<FeatureId, FeatureDefinition>> = {
  transactional_email: {
    id: "transactional_email",
    name: "Transactional email",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/emails", apiRoutes: ["POST /v1/emails"] },
  },
  email_api: {
    id: "email_api",
    name: "REST email API",
    status: "ready",
    mvp: true,
    surfaces: { apiRoutes: ["POST /v1/emails", "GET /v1/emails/:id"] },
  },
  email_delivery_pipeline: {
    id: "email_delivery_pipeline",
    name: "Queue, worker and provider delivery",
    status: "ready",
    mvp: true,
    note: "Queued sends drain through the worker to the configured provider; delivery events are recorded from provider feedback.",
  },
  email_templates: {
    id: "email_templates",
    name: "Email templates",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/templates", apiRoutes: ["/v1/templates"] },
    note: "Versioned HTML/plain-text templates with {{variable}} substitution, preview, and send-by-alias.",
  },
  sender_identities: {
    id: "sender_identities",
    name: "Sender identities",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/senders", apiRoutes: ["/v1/senders"] },
  },
  domains: {
    id: "domains",
    name: "Sending domains",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/domains", apiRoutes: ["/v1/domains"] },
  },
  domain_verification: {
    id: "domain_verification",
    name: "Domain ownership and DNS verification",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/domains" },
    note: "Ownership/DNS checks and provider identity status are both surfaced; ownership alone is not provider DKIM success.",
  },
  dkim: {
    id: "dkim",
    name: "DKIM signing via provider",
    status: "ready",
    mvp: true,
    note: "DKIM is performed by the delivery provider (SES); the dashboard reports the provider's identity status rather than claiming its own signer.",
  },
  spf: {
    id: "spf",
    name: "SPF guidance",
    status: "ready",
    mvp: true,
    note: "DNS records are published as guidance; Calder reports the provider's verification state, not a separate SPF validator.",
  },
  dmarc: {
    id: "dmarc",
    name: "DMARC guidance",
    status: "ready",
    mvp: true,
    note: "Advisory only: DMARC records are documented, not verified or enforced by Calder.",
  },
  delivery_tracking: {
    id: "delivery_tracking",
    name: "Delivery tracking",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/deliveries", apiRoutes: ["GET /v1/emails/:id"] },
  },
  delivery_logs: {
    id: "delivery_logs",
    name: "Delivery logs",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/emails", apiRoutes: ["GET /v1/emails"] },
  },
  suppression_management: {
    id: "suppression_management",
    name: "Transactional suppression management",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/suppressions", apiRoutes: ["/v1/suppressions"] },
    note: "Transactional suppression is part of the email MVP. Marketing suppression is a separate, not-yet-launched product.",
  },
  bounce_handling: {
    id: "bounce_handling",
    name: "Bounce classification",
    status: "ready",
    mvp: true,
    note: "Provider bounce events are classified and can add a suppression.",
  },
  complaint_handling: {
    id: "complaint_handling",
    name: "Complaint handling",
    status: "ready",
    mvp: true,
    note: "Provider complaint events are recorded and suppress the recipient.",
  },
  unsubscribe_handling: {
    id: "unsubscribe_handling",
    name: "Transactional unsubscribe",
    status: "ready",
    mvp: true,
    surfaces: { apiRoutes: ["/v1/unsubscribe"] },
    note: "Required compliance behaviour for stream-scoped unsubscribe, independent of the marketing campaign product.",
  },
  idempotency: {
    id: "idempotency",
    name: "Idempotency keys",
    status: "ready",
    mvp: true,
  },
  sending_limits: {
    id: "sending_limits",
    name: "Plan sending limits",
    status: "ready",
    mvp: true,
    note: "Monthly allowance and the Beginner daily cap are enforced at ingest.",
  },
  sandbox_environment: {
    id: "sandbox_environment",
    name: "Test environment",
    status: "ready",
    mvp: true,
    note: "Test keys deliver through the mock provider and are never metered.",
  },
  email_scheduling: {
    id: "email_scheduling",
    name: "Scheduled sending",
    status: "ready",
    mvp: true,
    note: "`scheduled_at` delays the queue job; the dashboard does not expose a scheduler UI yet.",
  },
  batch_sending: {
    id: "batch_sending",
    name: "Batch sending",
    status: "ready",
    mvp: true,
    surfaces: { apiRoutes: ["POST /v1/emails/batch"] },
  },
  api_keys: {
    id: "api_keys",
    name: "API keys",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/keys", apiRoutes: ["/v1/keys"] },
  },
  api_key_revocation: {
    id: "api_key_revocation",
    name: "API key revocation",
    status: "ready",
    mvp: true,
  },
  api_key_expiration: {
    id: "api_key_expiration",
    name: "API key expiration",
    status: "ready",
    mvp: true,
  },
  api_documentation: {
    id: "api_documentation",
    name: "API reference",
    status: "ready",
    mvp: true,
    note: "Live OpenAPI document at /v1/openapi.json plus docs/API.md.",
  },
  sdk_node: {
    id: "sdk_node",
    name: "Node.js SDK",
    status: "ready",
    mvp: true,
    note: "Source and repository tests exist; publication to npm and install-to-send smoke tests are not launch-certified, so public surfaces recommend direct HTTP.",
  },
  sdk_python: {
    id: "sdk_python",
    name: "Python SDK",
    status: "ready",
    mvp: true,
    note: "Source and repository tests exist; package publication is not launch-certified.",
  },
  sdk_ruby: {
    id: "sdk_ruby",
    name: "Ruby SDK",
    status: "coming_soon",
    mvp: true,
    note: "Source exists, but it has no test suite and has not been runtime-verified.",
    blocker: "Ruby SDK needs an automated test that sends through the API and is exercised in CI.",
    ownerAction: "Engineering: add Ruby tests; decide whether to publish or remove from docs.",
  },
  sdk_php: {
    id: "sdk_php",
    name: "PHP SDK",
    status: "coming_soon",
    mvp: true,
    note: "Source exists, but it has no test suite and has not been runtime-verified.",
    blocker: "PHP SDK needs an automated test that sends through the API and is exercised in CI.",
    ownerAction: "Engineering: add PHP tests; decide whether to publish or remove from docs.",
  },
  cli: {
    id: "cli",
    name: "Calder CLI",
    status: "not_supported",
    mvp: false,
    note: "No CLI package exists in this repository.",
  },
  webhooks: {
    id: "webhooks",
    name: "Signed webhooks with retries",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/webhooks", apiRoutes: ["/v1/webhooks"] },
  },
  webhook_logs: {
    id: "webhook_logs",
    name: "Webhook delivery history",
    status: "ready",
    mvp: true,
  },
  webhook_replay: {
    id: "webhook_replay",
    name: "Webhook replay",
    status: "ready",
    mvp: true,
    note: "The public pricing table lists replay as Starter-and-above, but no tier gate is enforced today (billing is not live, so every organization is on Beginner). See docs/MVP-FEATURE-MATRIX.md — owner decision.",
  },
  smtp_gateway: {
    id: "smtp_gateway",
    name: "SMTP gateway",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/smtp" },
    note: "No SMTP gateway application exists. There is no host or credential to connect to; use the REST API.",
    blocker: "SMTP gateway implementation and acceptance tests; docs/SMTP.md is a specification only.",
    ownerAction: "Product/engineering: decide whether SMTP is in scope for the next milestone. Do not advertise a host until it accepts a real authenticated message.",
  },
  inbound_email: {
    id: "inbound_email",
    name: "Inbound email / Inbox",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/inbox" },
    note: "Inbound email is not part of the MVP. Outbound webhooks are available; receiving mail is not.",
    blocker: "No inbound ingestion pipeline, MX handling, or inbound webhook event exists.",
    ownerAction: "Product: keep out of MVP; do not promise inbound routing on the dashboard.",
  },
  gmail_integration: {
    id: "gmail_integration",
    name: "Gmail transport",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/integrations" },
    note: "OAuth code exists, but production OAuth approval and a verified send are not confirmed.",
    blocker: "Google OAuth production approval and one verified end-to-end send.",
    ownerAction: "Owner: complete Google verification, then flip this feature and the public Gmail copy together.",
  },
  workspace_overview: {
    id: "workspace_overview",
    name: "Workspace overview",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/" },
  },
  projects: {
    id: "projects",
    name: "Projects",
    status: "ready",
    mvp: true,
    note: "Project creation is limited by plan; existing projects are grandfathered.",
  },
  environments: {
    id: "environments",
    name: "Environments",
    status: "ready",
    mvp: true,
    note: "Test/live keys are enforced. The per-plan environment matrix on the pricing page is not enforced.",
  },
  team_management: {
    id: "team_management",
    name: "Team management",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/settings" },
    note: "Invitations and seat limits are enforced.",
  },
  organization_settings: {
    id: "organization_settings",
    name: "Organization settings",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/settings" },
  },
  usage_overview: {
    id: "usage_overview",
    name: "Usage and quota overview",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/usage" },
  },
  audit_logs: {
    id: "audit_logs",
    name: "Audit logs",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/audit-logs" },
    note: "Available on every tier today; the pricing page lists audit logs as Pro-and-above. Owner decision: enforcement would remove an existing capability from free organizations.",
  },
  integrations: {
    id: "integrations",
    name: "Third-party integrations",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/integrations" },
    note: "No third-party integration is live; the page lists planned connectors.",
  },
  basic_usage_analytics: {
    id: "basic_usage_analytics",
    name: "Basic usage analytics",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/usage" },
    note: "Volume over time, delivered/sent/failed counts, from this organization's own email records.",
  },
  email_volume_tracking: {
    id: "email_volume_tracking",
    name: "Email volume tracking",
    status: "ready",
    mvp: true,
    surfaces: { dashboardHref: "/usage" },
  },
  bounce_statistics: {
    id: "bounce_statistics",
    name: "Bounce statistics",
    status: "coming_soon",
    mvp: false,
    note: "Bounces are individually visible in delivery logs, but no aggregate bounce analytics exists.",
    ownerAction: "Product: decide whether aggregate bounce/complaint reporting belongs in the next milestone.",
  },
  complaint_statistics: {
    id: "complaint_statistics",
    name: "Complaint statistics",
    status: "coming_soon",
    mvp: false,
    note: "Complaints are recorded per message; no aggregate complaint reporting exists.",
  },
  delivery_trends: {
    id: "delivery_trends",
    name: "Delivery trends",
    status: "ready",
    mvp: true,
    note: "The Overview page shows a 30-day/24-hour volume series from real email records.",
  },
  advanced_analytics: {
    id: "advanced_analytics",
    name: "Advanced analytics",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/analytics" },
    note: "No advanced analytics implementation exists. The previous page offered an upgrade for a feature that could not be used.",
    ownerAction: "Product/engineering: define and build the advanced analytics surface before listing it as a paid capability.",
  },
  usage_forecasting: {
    id: "usage_forecasting",
    name: "Usage forecasting",
    status: "not_supported",
    mvp: false,
    note: "Not implemented and not advertised.",
  },
  uptime_status: {
    id: "uptime_status",
    name: "Service status and health",
    status: "ready",
    mvp: true,
    note: "Public status page states what is actually monitored. No uptime percentage is published because no historical uptime dataset exists.",
  },
  platform_incidents: {
    id: "platform_incidents",
    name: "Incident reporting",
    status: "ready",
    mvp: true,
    note: "Manually maintained incident history; no fabricated entries.",
  },
  customer_uptime_history: {
    id: "customer_uptime_history",
    name: "Customer-facing uptime history",
    status: "coming_soon",
    mvp: false,
    note: "No historical uptime data is collected for publication.",
    ownerAction: "Operations: choose a monitoring source with retained history before publishing per-component uptime.",
  },
  marketing_overview: {
    id: "marketing_overview",
    name: "Marketing overview",
    status: "coming_soon",
    mvp: false,
    note: "The marketing suite is not in the MVP.",
    ownerAction: "Product: schedule the marketing suite as a separate launch with its own acceptance criteria.",
  },
  broadcasts: {
    id: "broadcasts",
    name: "Broadcasts",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/broadcasts", apiRoutes: ["/v1/broadcasts"] },
    note: "Broadcast code exists in the repository, but the product is not part of the MVP. The API is disabled server-side and the dashboard shows Coming Soon.",
    blocker: "Marketing launch decision plus campaign acceptance tests and contact/consent enforcement.",
    ownerAction: "Product: keep disabled until a marketing launch is approved. Do not re-enable the API without that decision.",
  },
  campaigns: {
    id: "campaigns",
    name: "Campaigns",
    status: "coming_soon",
    mvp: false,
    note: "No campaign creation workflow is in the MVP.",
  },
  audiences: {
    id: "audiences",
    name: "Audiences and contacts",
    status: "coming_soon",
    mvp: false,
    surfaces: { dashboardHref: "/audiences", apiRoutes: ["/v1/audiences"] },
    note: "Audience/contact storage exists in code but is not in the MVP; the API is disabled server-side.",
  },
  contacts: {
    id: "contacts",
    name: "Contact management",
    status: "coming_soon",
    mvp: false,
    note: "Marketing contacts are not part of the MVP and must not be confused with transactional recipients.",
  },
  segments: {
    id: "segments",
    name: "Segments",
    status: "not_supported",
    mvp: false,
    note: "Not implemented and not in the MVP; no dashboard surface.",
  },
  marketing_automations: {
    id: "marketing_automations",
    name: "Marketing automations",
    status: "not_supported",
    mvp: false,
    note: "Not implemented and not in the MVP; no dashboard surface.",
  },
  marketing_templates: {
    id: "marketing_templates",
    name: "Marketing templates",
    status: "not_supported",
    mvp: false,
    note: "Transactional email templates are the MVP feature. Marketing templates are not a separate product in this release.",
  },
  campaign_analytics: {
    id: "campaign_analytics",
    name: "Campaign analytics",
    status: "coming_soon",
    mvp: false,
    note: "Not part of the MVP; no numbers are displayed anywhere.",
  },
  marketing_unsubscribes: {
    id: "marketing_unsubscribes",
    name: "Marketing unsubscribe management",
    status: "coming_soon",
    mvp: false,
    note: "Transactional unsubscribe and suppression are live; campaign-level unsubscribe management is not a launched product.",
  },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** Every feature in a given status. Used by docs, tests and dashboards. */
export function featuresWithStatus(status: FeatureStatus): FeatureDefinition[] {
  return FEATURE_IDS.map((id) => FEATURES[id]).filter((f) => f.status === status);
}

export function featureFor(id: FeatureId): FeatureDefinition {
  return FEATURES[id];
}

/** Implemented end-to-end. Says nothing about the customer's plan. */
export function isFeatureLive(id: FeatureId): boolean {
  return FEATURES[id].status === "ready";
}

/**
 * Tiers whose plan includes the feature. A feature with no `plans` entry is
 * included everywhere — true for every implemented capability today, because
 * no paid tier is assignable while billing is off.
 */
export function featurePlans(id: FeatureId): readonly PlanTier[] {
  return FEATURES[id].plans ?? ALL_TIERS;
}

/**
 * Does `tier` include `id`?
 *
 * Unknown, empty and exempt tiers fail closed to the smallest catalogue tier
 * (the same rule as `planFor`): a typo must not grant capability. `internal`
 * and `n/a` are engine identities and are treated as entitled to everything.
 */
export function planIncludesFeature(id: FeatureId, tier: string | null | undefined): boolean {
  if (isExemptTier(tier)) return true;
  const plan = tier && tier in PLAN_LIMITS ? (tier as PlanTier) : "free";
  return featurePlans(id).includes(plan);
}

export type UnavailableReason = "available" | "coming_soon" | "not_supported" | "plan_required";

export interface FeatureAvailability {
  id: FeatureId;
  name: string;
  status: FeatureStatus;
  mvp: boolean;
  /** Implemented and testable. */
  live: boolean;
  /** The customer's plan includes it. */
  entitled: boolean;
  /** `live && entitled` — the only condition a surface may treat as usable. */
  available: boolean;
  reason: UnavailableReason;
  /** Tiers that include it, for a "available on Pro" style message. */
  plans: readonly PlanTier[];
  note?: string;
}

export function featureAvailability(
  id: FeatureId,
  tier: string | null | undefined
): FeatureAvailability {
  const feature = FEATURES[id];
  const live = feature.status === "ready";
  const entitled = planIncludesFeature(id, tier);
  const reason: UnavailableReason = !live
    ? feature.status === "coming_soon"
      ? "coming_soon"
      : "not_supported"
    : !entitled
      ? "plan_required"
      : "available";
  return {
    id,
    name: feature.name,
    status: feature.status,
    mvp: feature.mvp,
    live,
    entitled,
    available: live && entitled,
    reason,
    plans: featurePlans(id),
    note: feature.note,
  };
}

/** Customer-facing label for an unavailable feature. */
export function featureAvailabilityLabel(availability: FeatureAvailability): string {
  switch (availability.reason) {
    case "available":
      return "Available";
    case "coming_soon":
      return "Coming Soon";
    case "not_supported":
      return "Not available";
    case "plan_required":
      return "Upgrade required";
  }
}

/* ── Advertised-but-not-enforced plan differences ────────────────────────── */

/**
 * Claims on the public pricing page that describe a tier difference the
 * backend does not enforce. They are recorded here rather than silently
 * "fixed" by inventing an entitlement or by weakening the pricing page: each
 * one is a commercial decision, not an engineering one.
 *
 * A paid checkout must not go live while this list is non-empty without an
 * explicit decision, because the customer would be paying for a distinction
 * the product does not implement.
 */
export interface UnenforcedPlanDifference {
  feature: FeatureId;
  advertised: string;
  reality: string;
  decision: string;
}

export const UNENFORCED_PLAN_DIFFERENCES: readonly UnenforcedPlanDifference[] = [
  {
    feature: "webhook_replay",
    advertised: "Webhook replay and delivery history: Starter and above.",
    reality: "Replay is available to every organization, including Beginner.",
    decision:
      "Owner: either gate replay on Starter+ (removing it from existing free organizations) or change the pricing row to include Beginner.",
  },
  {
    feature: "audit_logs",
    advertised: "Audit logs and security events: Pro and above.",
    reality: "The audit log page is available to every organization.",
    decision:
      "Owner: gate audit logs to Pro+ or correct the pricing row. Existing free organizations would lose access if gated.",
  },
  {
    feature: "environments",
    advertised:
      "Beginner is limited to the development environment; Starter's environment matrix is unset; Pro+ get staging and production.",
    reality: "Every project can create test and live keys; no environment gate exists.",
    decision:
      "Owner: define Starter's environments and decide whether environment access becomes an enforced entitlement.",
  },
];

/** Short reason phrase safe to print next to a disabled control. */
export function featureDisabledMessage(id: FeatureId): string {
  const feature = FEATURES[id];
  return feature.status === "coming_soon"
    ? `${feature.name} is coming soon and is not available in this release.`
    : `${feature.name} is not available.`;
}
