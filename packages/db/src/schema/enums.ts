import { pgEnum } from "drizzle-orm/pg-core";

export const organizationRoleEnum = pgEnum("organization_role", ["owner", "admin", "member"]);
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

export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
