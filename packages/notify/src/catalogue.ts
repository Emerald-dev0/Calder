/**
 * The catalogue of every email Calder sends to its own users.
 *
 * This file is the contract, not documentation: `sendCompanyEmail` refuses an
 * id that is not here, the preference page is generated from these categories,
 * and the test suite asserts that every entry has a template and a mandatory
 * one cannot be switched off.
 *
 * Three rules the catalogue encodes:
 *
 *  1. **Category decides consent.** `updates` and `digest` are opt-out; every
 *     other category is mandatory, because it concerns the account, money,
 *     security, the service's own state or a legal obligation. Nobody may
 *     unsubscribe from "your payment failed".
 *  2. **`audience` says who receives it.** `user` is a single person;
 *     `organization` is addressed to owners/admins of a workspace.
 *  3. **`data` lists the facts the template interpolates.** It is not enforced
 *     at runtime (the renderer tolerates a missing field), but it is what a
 *     caller reads to know what to pass.
 */

export const COMPANY_EMAIL_CATEGORIES = [
  "account",
  "security",
  "billing",
  "legal",
  "usage",
  "operations",
  "updates",
  "digest",
] as const;

export type CompanyEmailCategory = (typeof COMPANY_EMAIL_CATEGORIES)[number];

/** The only categories a person may switch off. Everything else is mandatory. */
export const OPTIONAL_CATEGORIES = ["updates", "digest"] as const;

export function isOptionalCategory(category: string): boolean {
  return (OPTIONAL_CATEGORIES as readonly string[]).includes(category);
}

export interface CompanyEmailDefinition {
  category: CompanyEmailCategory;
  /** `user` = one person; `organization` = the workspace's owners/admins. */
  audience: "user" | "organization";
  /** Always equal to `!isOptionalCategory(category)`; stored for readability. */
  mandatory: boolean;
  /** One line an operator can read in a list. */
  description: string;
  /** When it fires, in the code's own terms. */
  trigger: string;
  /** Facts the template interpolates. */
  data: readonly string[];
}

function def(
  category: CompanyEmailCategory,
  audience: "user" | "organization",
  description: string,
  trigger: string,
  data: readonly string[] = []
): CompanyEmailDefinition {
  return { category, audience, mandatory: !isOptionalCategory(category), description, trigger, data };
}

export const COMPANY_EMAILS = {
  /* ── Account ─────────────────────────────────────────────────────────── */
  "account.welcome": def(
    "account",
    "user",
    "Welcome aboard, with the first three things to do",
    "First successful email verification of a new account",
    ["name"]
  ),
  "account.verification_code": def(
    "account",
    "user",
    "Six-digit signup verification code",
    "POST /api/auth/signup (and resend)",
    ["code", "expiresInMinutes"]
  ),
  "account.password_reset_code": def(
    "account",
    "user",
    "Six-digit password reset code",
    "POST /api/auth/login (forgotten password) and /api/auth/email-code",
    ["code", "expiresInMinutes"]
  ),
  "account.password_changed": def(
    "account",
    "user",
    "Password changed from the dashboard",
    "POST /api/auth/password-change",
    ["when", "ip"]
  ),
  "account.password_reset_completed": def(
    "account",
    "user",
    "Password reset completed with a recovery code",
    "POST /api/auth/password-reset",
    ["when", "ip"]
  ),
  "account.new_sign_in": def(
    "account",
    "user",
    "New sign-in with time, IP and device",
    "Successful login by password, code, magic link or OAuth",
    ["when", "ip", "device", "method"]
  ),
  "account.sessions_revoked": def(
    "account",
    "user",
    "Every session was signed out",
    "Password reset, or Settings → Sessions → sign out everywhere",
    ["when", "reason"]
  ),
  "account.two_factor_enabled": def(
    "account",
    "user",
    "Two-factor authentication switched on",
    "Settings → Security → enable 2FA",
    ["when"]
  ),
  "account.two_factor_disabled": def(
    "account",
    "user",
    "Two-factor authentication switched off",
    "Settings → Security → disable 2FA",
    ["when"]
  ),
  "account.recovery_codes_generated": def(
    "account",
    "user",
    "New two-factor recovery codes were generated",
    "Settings → Security → regenerate recovery codes",
    ["count", "when"]
  ),
  "account.sign_in_method_added": def(
    "account",
    "user",
    "An OAuth provider was connected",
    "GET /api/auth/callback/:provider",
    ["provider", "when"]
  ),
  "account.sign_in_method_removed": def(
    "account",
    "user",
    "An OAuth provider was disconnected",
    "POST /api/auth/oauth/disconnect",
    ["provider", "when"]
  ),
  "account.email_change_requested": def(
    "account",
    "user",
    "Confirm a new email address (sent to the new address)",
    "Settings → Profile → change email",
    ["newEmail", "confirmUrl", "expiresInHours"]
  ),
  "account.email_changed": def(
    "account",
    "user",
    "The account email was changed (sent to the old address)",
    "Confirmation of an email change",
    ["oldEmail", "newEmail", "when"]
  ),
  "account.locked_out": def(
    "account",
    "user",
    "Too many failed sign-ins locked the account temporarily",
    "Progressive login lockout (ADR-040)",
    ["lockedUntil", "attempts", "ip"]
  ),
  "account.suspicious_sign_in_blocked": def(
    "account",
    "user",
    "A sign-in was refused and needs the owner's attention",
    "Impossible-travel / new-country policy, when enabled",
    ["when", "ip", "reason"]
  ),
  "account.deletion_scheduled": def(
    "account",
    "user",
    "Account deletion requested, with the grace period",
    "Settings → Danger zone → delete account",
    ["deletesOn", "cancelUrl"]
  ),
  "account.deleted": def(
    "account",
    "user",
    "Account deletion completed",
    "Deletion job after the grace period",
    ["when"]
  ),
  "account.data_export_ready": def(
    "account",
    "user",
    "GDPR data export is ready to download",
    "Data export job completion",
    ["downloadUrl", "expiresInHours"]
  ),
  "account.data_export_failed": def(
    "account",
    "user",
    "A data export could not be produced",
    "Data export job failure",
    ["requestedAt", "supportUrl"]
  ),

  /* ── Organization ────────────────────────────────────────────────────── */
  "organization.invitation": def(
    "account",
    "user",
    "You have been invited to a workspace",
    "POST inviteMember (dashboard team settings)",
    ["inviterName", "organizationName", "role", "acceptUrl", "expiresInDays"]
  ),
  "organization.invitation_reminder": def(
    "account",
    "user",
    "Reminder for an unaccepted invitation",
    "Scheduled reminder 3 days before expiry",
    ["inviterName", "organizationName", "acceptUrl", "expiresInDays"]
  ),
  "organization.invitation_accepted": def(
    "account",
    "user",
    "Someone accepted your invitation",
    "Invitation acceptance on first login",
    ["memberName", "memberEmail", "organizationName"]
  ),
  "organization.role_changed": def(
    "account",
    "user",
    "Your role in a workspace changed",
    "PATCH member role",
    ["organizationName", "oldRole", "newRole", "changedBy"]
  ),
  "organization.member_removed": def(
    "account",
    "user",
    "You were removed from a workspace",
    "DELETE member",
    ["organizationName", "removedBy"]
  ),
  "organization.ownership_transferred": def(
    "account",
    "user",
    "Workspace ownership moved to or from you",
    "Transfer ownership",
    ["organizationName", "direction", "otherParty"]
  ),
  "organization.workspace_created": def(
    "account",
    "user",
    "A new workspace was created",
    "Workspace creation",
    ["organizationName", "projectName"]
  ),

  /* ── Billing ─────────────────────────────────────────────────────────── */
  "billing.trial_started": def(
    "billing",
    "organization",
    "A trial started, with its end date and what happens after",
    "Subscription created with a trial",
    ["planName", "trialEndsOn", "emailLimit"]
  ),
  "billing.trial_ending": def(
    "billing",
    "organization",
    "Trial ends in three days",
    "Scheduled, T-3 days",
    ["planName", "trialEndsOn", "priceNgn", "priceUsd"]
  ),
  "billing.trial_ended": def(
    "billing",
    "organization",
    "Trial ended and the workspace moved to its plan",
    "Trial expiry job",
    ["planName", "emailLimit"]
  ),
  "billing.payment_succeeded": def(
    "billing",
    "organization",
    "Receipt for a successful payment",
    "Bachs charge.succeeded",
    ["amount", "currency", "planName", "invoiceUrl", "paidOn", "reference"]
  ),
  "billing.payment_failed": def(
    "billing",
    "organization",
    "A payment failed, with what happens next",
    "Bachs charge.failed (first attempt)",
    ["amount", "currency", "planName", "retryOn", "updateUrl"]
  ),
  "billing.payment_failed_final": def(
    "billing",
    "organization",
    "Final notice before the plan is downgraded",
    "Third failed attempt",
    ["amount", "currency", "planName", "downgradeOn", "updateUrl"]
  ),
  "billing.invoice_ready": def(
    "billing",
    "organization",
    "A new invoice is available",
    "Invoice created",
    ["invoiceNumber", "amount", "currency", "dueOn", "invoiceUrl"]
  ),
  "billing.plan_upgraded": def(
    "billing",
    "organization",
    "Plan upgraded, with the new ceilings",
    "Subscription plan change (upgrade)",
    ["oldPlan", "newPlan", "emailLimit", "effectiveOn"]
  ),
  "billing.plan_downgraded": def(
    "billing",
    "organization",
    "Plan downgraded, with what changes",
    "Subscription plan change (downgrade or dunning)",
    ["oldPlan", "newPlan", "emailLimit", "effectiveOn", "overLimitNote"]
  ),
  "billing.subscription_canceled": def(
    "billing",
    "organization",
    "Subscription cancelled, access until the period end",
    "Bachs subscription.cancelled or self-serve cancel",
    ["planName", "accessUntil"]
  ),
  "billing.subscription_reactivated": def(
    "billing",
    "organization",
    "A cancelled subscription was resumed",
    "Subscription resumed",
    ["planName", "renewsOn"]
  ),
  "billing.refund_issued": def(
    "billing",
    "organization",
    "A refund was issued",
    "Bachs refund.created",
    ["amount", "currency", "reference", "daysToSettle"]
  ),
  "billing.payment_method_expiring": def(
    "billing",
    "organization",
    "The card on file expires soon",
    "Scheduled monthly check",
    ["lastFour", "expiryMonth", "expiryYear", "updateUrl"]
  ),

  /* ── Usage ───────────────────────────────────────────────────────────── */
  "usage.warning_80": def(
    "usage",
    "organization",
    "80% of the monthly email allowance is used",
    "Send path, threshold crossing (once per period)",
    ["planName", "used", "limit", "percent", "resetsOn"]
  ),
  "usage.exhausted_100": def(
    "usage",
    "organization",
    "The monthly allowance is exhausted and sending is blocked",
    "Send path, at the ceiling (once per period)",
    ["planName", "limit", "resetsOn", "pricingUrl"]
  ),
  "usage.reset": def(
    "usage",
    "organization",
    "A new billing period started, with the fresh allowance",
    "Period rollover job, first send of the new period",
    ["planName", "limit", "periodStart", "periodEnd"]
  ),
  "usage.resource_limit": def(
    "usage",
    "organization",
    "A resource ceiling (projects, domains, senders, seats) was reached",
    "checkResourceLimit refusal on a creation path",
    ["resource", "limit", "planName", "upgradePlan"]
  ),

  /* ── Operations ──────────────────────────────────────────────────────── */
  "operations.domain_verified": def(
    "operations",
    "organization",
    "A sending domain is verified",
    "Domain verification succeeded",
    ["domain", "projectName"]
  ),
  "operations.domain_failed": def(
    "operations",
    "organization",
    "A sending domain failed verification",
    "Domain verification failed",
    ["domain", "projectName", "reason", "recordsUrl"]
  ),
  "operations.domain_dns_lost": def(
    "operations",
    "organization",
    "A verified domain lost its DNS records",
    "Periodic re-check found the domain unverified",
    ["domain", "projectName", "recordsUrl"]
  ),
  "operations.api_key_created": def(
    "operations",
    "organization",
    "An API key was created",
    "POST /v1/keys",
    ["keyName", "keyPrefix", "env", "createdBy", "when"]
  ),
  "operations.api_key_revoked": def(
    "operations",
    "organization",
    "An API key was revoked",
    "POST /v1/keys/:id/revoke or rotate",
    ["keyName", "keyPrefix", "env", "revokedBy", "when"]
  ),
  "operations.api_key_expiring": def(
    "operations",
    "organization",
    "An API key expires within seven days",
    "Scheduled daily check",
    ["keyName", "keyPrefix", "expiresOn"]
  ),
  "operations.webhook_failing": def(
    "operations",
    "organization",
    "A webhook endpoint is failing",
    "A delivery exhausted its retries",
    ["endpointUrl", "event", "lastError", "deliveryId"]
  ),
  "operations.webhook_disabled": def(
    "operations",
    "organization",
    "A webhook endpoint was disabled after sustained failure",
    "Auto-disable after N consecutive exhausted deliveries",
    ["endpointUrl", "failureCount", "reenableUrl"]
  ),
  "operations.broadcast_completed": def(
    "operations",
    "organization",
    "A broadcast finished sending",
    "Broadcast engine completion",
    ["broadcastName", "recipients", "delivered", "bounced", "unsubscribed", "reportUrl"]
  ),
  "operations.broadcast_paused": def(
    "operations",
    "organization",
    "A broadcast auto-paused on a safety threshold",
    "Bounce > 5% or complaint > 0.1% during sending",
    ["broadcastName", "reason", "sent", "bounced", "complained", "reportUrl"]
  ),
  "operations.bounce_rate_warning": def(
    "operations",
    "organization",
    "The workspace bounce rate crossed the warning line",
    "Scheduled daily check",
    ["bounceRate", "window", "topReason", "suppressionsUrl"]
  ),
  "operations.complaint_rate_warning": def(
    "operations",
    "organization",
    "The workspace complaint rate crossed the warning line",
    "Scheduled daily check",
    ["complaintRate", "window", "suppressionsUrl"]
  ),

  /* ── Legal ───────────────────────────────────────────────────────────── */
  "legal.policy_update": def(
    "legal",
    "user",
    "Terms or privacy policy changed",
    "Published policy version bump",
    ["document", "effectiveOn", "summary", "policyUrl"]
  ),

  /* ── Optional: product updates and digest ────────────────────────────── */
  "updates.product_update": def(
    "updates",
    "user",
    "Product changelog for people who asked for it",
    "Manual send from the control plane",
    ["title", "body", "ctaLabel", "ctaUrl"]
  ),
  "updates.monthly_digest": def(
    "digest",
    "organization",
    "Monthly recap: volume, deliverability, what shipped",
    "Scheduled, first of the month",
    ["period", "sent", "delivered", "bounceRate", "topSender", "highlights"]
  ),
  "updates.announcement": def(
    "updates",
    "user",
    "A significant announcement (pricing, launch, sunset)",
    "Manual send from the control plane",
    ["title", "body", "ctaLabel", "ctaUrl"]
  ),
} as const satisfies Record<string, CompanyEmailDefinition>;

export type CompanyEmailId = keyof typeof COMPANY_EMAILS;

export const COMPANY_EMAIL_IDS = Object.keys(COMPANY_EMAILS) as CompanyEmailId[];

export function companyEmailDefinition(id: string): CompanyEmailDefinition | null {
  return (COMPANY_EMAILS as Record<string, CompanyEmailDefinition>)[id] ?? null;
}
