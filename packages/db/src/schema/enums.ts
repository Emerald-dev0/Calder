import { pgEnum } from "drizzle-orm/pg-core";

export const organizationRoleEnum = pgEnum("organization_role", ["owner", "admin", "member"]);
export const organizationSendingStatusEnum = pgEnum("organization_sending_status", [
  "active",
  "abuse_paused",
  "suspended",
]);
export const apiKeyEnvEnum = pgEnum("api_key_env", ["test", "live"]);
export const domainStatusEnum = pgEnum("domain_status", [
  "pending",
  "verified",
  "failed",
  "expired",
]);
export const domainVerificationMethodEnum = pgEnum("domain_verification_method", [
  "dns",
  "vercel",
  "http",
]);
// Reputation lanes: recorded per email so promotional traffic can be tracked
// (and later routed) independently of transactional traffic. Annotation only —
// it never changes suppression, quota, consent or sender-verification checks.
export const emailStreamEnum = pgEnum("email_stream", ["transactional", "marketing"]);
export const emailStatusEnum = pgEnum("email_status", [
  "created",
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);
export const emailEventTypeEnum = pgEnum("email_event_type", [
  "created",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "opened",
  "clicked",
  "suppressed",
]);
export const webhookEventEnum = pgEnum("webhook_event", [
  "email.queued",
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.opened",
  "email.clicked",
]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
  "exhausted",
]);
export const planTierEnum = pgEnum("plan_tier", ["free", "starter", "pro", "scale"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
  "incomplete",
]);
export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "bounce",
  "complaint",
  "unsubscribe",
  "manual",
]);
export const otpPurposeEnum = pgEnum("otp_purpose", ["verification", "login", "reset"]);
export const transportTypeEnum = pgEnum("transport_type", ["gmail", "ses", "managed"]);
export const transportStatusEnum = pgEnum("transport_status", ["active", "suspended", "revoked"]);
/** Sender identity kind. Only implemented transports appear here; extend by migration. */
export const senderTypeEnum = pgEnum("sender_type", ["domain", "gmail", "managed"]);
/**
 * Sender readiness. pending = verification in flight; verified/connected =
 * usable (domain vs integrated); disabled/failed = blocked with a reason.
 * "Needs attention" is derived in UI, never stored.
 */
export const senderStatusEnum = pgEnum("sender_status", [
  "pending",
  "verified",
  "connected",
  "disabled",
  "failed",
]);
/**
 * Platform-level role (Control Plane access). Completely separate from
 * organization roles: a platform role says what you may operate of CALDER
 * itself, an organization role says what you may do inside one customer
 * workspace. `founder` is the apex — full access plus ownership actions no
 * other role can perform or grant. Assignment happens out-of-band (SQL /
 * seed), never through a self-service UI.
 */
export const platformRoleEnum = pgEnum("platform_role", [
  "founder",
  "platform_admin",
  "support",
  "billing",
  "infrastructure",
  "security",
  "analyst",
]);
/** Waitlist lifecycle. Conversion (joined as a user) is derived live, never stored. */
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "waiting",
  "invited",
  "contacted",
  "removed",
]);

// ── Broadcasts, audiences, consent ───────────────────────────

/**
 * Contact lifecycle at the workspace-project level. `pending_confirmation`
 * only exists for double opt-in audiences; the provider feedback loop can move
 * a contact to `bounced` or `complained`, and only an explicit resubscribe
 * moves it back to `subscribed`.
 */
export const contactStatusEnum = pgEnum("contact_status", [
  "subscribed",
  "unsubscribed",
  "bounced",
  "complained",
  "pending_confirmation",
]);
/** How the contact's consent was obtained. Provenance is never inferred later. */
export const contactConsentSourceEnum = pgEnum("contact_consent_source", [
  "import",
  "api",
  "form",
  "manual",
  "double_opt_in",
]);
/** Membership state of a contact inside one audience. Narrower than contact_status. */
export const audienceContactStatusEnum = pgEnum("audience_contact_status", [
  "subscribed",
  "unsubscribed",
  "pending_confirmation",
]);
export const contactImportStatusEnum = pgEnum("contact_import_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const broadcastStatusEnum = pgEnum("broadcast_status", [
  "draft",
  "scheduled",
  "queued",
  "sending",
  "paused",
  "sent",
  "cancelled",
  "failed",
]);
export const broadcastRecipientStatusEnum = pgEnum("broadcast_recipient_status", [
  "pending",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "failed",
  "skipped",
  "cancelled",
]);
/** Why a recipient never became a send. Never inferred; set at skip time. */
export const broadcastSkipReasonEnum = pgEnum("broadcast_skip_reason", [
  "unsubscribed",
  "bounced",
  "complained",
  "suppressed",
  "invalid",
  "duplicate",
]);
export const unsubscribeSourceEnum = pgEnum("unsubscribe_source", [
  "link_click",
  "one_click_header",
  "mailto",
  "complaint",
  "manual",
  "api",
  "preference_center",
]);
/** `audience` = left this list only; `workspace` = no marketing mail from this project. */
export const unsubscribeScopeEnum = pgEnum("unsubscribe_scope", ["audience", "workspace"]);
export const resubscribeSourceEnum = pgEnum("resubscribe_source", [
  "unsubscribe_page",
  "preference_center",
  "double_opt_in_confirmation",
  "manual",
  "api",
]);

export type ContactStatus = (typeof contactStatusEnum.enumValues)[number];
export type ContactConsentSource = (typeof contactConsentSourceEnum.enumValues)[number];
export type AudienceContactStatus = (typeof audienceContactStatusEnum.enumValues)[number];
export type BroadcastStatus = (typeof broadcastStatusEnum.enumValues)[number];
export type BroadcastRecipientStatus = (typeof broadcastRecipientStatusEnum.enumValues)[number];
export type BroadcastSkipReason = (typeof broadcastSkipReasonEnum.enumValues)[number];
export type UnsubscribeSource = (typeof unsubscribeSourceEnum.enumValues)[number];
export type UnsubscribeScope = (typeof unsubscribeScopeEnum.enumValues)[number];
export type ResubscribeSource = (typeof resubscribeSourceEnum.enumValues)[number];

export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
