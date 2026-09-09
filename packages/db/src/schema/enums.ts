import { pgEnum } from "drizzle-orm/pg-core";

export const organizationRoleEnum = pgEnum("organization_role", ["owner", "admin", "member"]);
export const apiKeyEnvEnum = pgEnum("api_key_env", ["test", "live"]);
export const domainStatusEnum = pgEnum("domain_status", ["pending", "verified", "failed"]);
export const domainVerificationMethodEnum = pgEnum("domain_verification_method", [
 "dns",
 "vercel",
 "http",
]);
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
