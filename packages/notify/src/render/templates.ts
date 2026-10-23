import type { CompanyEmailId } from "../catalogue.js";

/**
 * Copy for every email in the catalogue.
 *
 * House style, enforced by review rather than code:
 *  - say what happened, then what to do, in that order;
 *  - never invent a number — every figure is passed in by the caller;
 *  - dates and money arrive pre-formatted (`₦5,000`, `12 March 2026`), so this
 *    module has no locale or timezone opinions;
 *  - no exclamation marks in security or billing mail. One is enough in a
 *    welcome.
 *
 * Everything returned here is plain text. `render.ts` escapes it and decides
 * how it looks, so a name containing `<` cannot break the document.
 */

export interface RenderUrls {
  app: string;
  dashboard: string;
  preferences: string;
  support: string;
}

export interface CompanyEmailContent {
  subject: string;
  preheader: string;
  heading: string;
  intro: string[];
  details?: Array<{ label: string; value: string }>;
  code?: string;
  codeCaption?: string;
  cta?: { label: string; url: string };
  callout?: { tone: "info" | "success" | "warning" | "danger"; title?: string; body: string };
  outro?: string[];
  footnote?: string;
  linkLine?: { text: string; label: string; url: string };
}

type Data = Record<string, unknown>;

const s = (d: Data, key: string, fallback = ""): string => {
  const value = d[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};

const greeting = (d: Data): string => {
  const name = s(d, "name").trim();
  return name ? `Hi ${name.split(" ")[0]},` : "Hi,";
};

type Builder = (d: Data, u: RenderUrls) => CompanyEmailContent;

export const TEMPLATES: Record<CompanyEmailId, Builder> = {
  /* ── Account ────────────────────────────────────────────────────────── */
  "account.welcome": (d, u) => ({
    subject: "Welcome to Calder",
    preheader: "Your account is verified. Here is where to start.",
    heading: "You're in.",
    intro: [
      greeting(d),
      "Your email is verified and your workspace is ready. Calder handles transactional and broadcast email through one API, with deliverability, suppression and billing in the same place.",
      "Three things worth doing first:",
    ],
    details: [
      { label: "1. Verify a domain", value: "Send from your own address, not a sandbox" },
      { label: "2. Create an API key", value: "Your first send is one request away" },
      { label: "3. Send a test", value: "Confirm delivery end to end" },
    ],
    cta: { label: "Open your dashboard", url: u.dashboard },
    outro: ["If anything looks wrong, reply to this email — it reaches a person."],
  }),

  "account.verification_code": (d) => ({
    subject: `${s(d, "code")} is your Calder verification code`,
    preheader: "Use this code to finish creating your account.",
    heading: "Verify your email address",
    intro: [
      "Enter this code to finish creating your account. It expires in " +
        `${s(d, "expiresInMinutes", "10")} minutes.`,
    ],
    code: s(d, "code"),
    codeCaption: "Six digits, no spaces",
    outro: [
      "If you did not request this, ignore this email. No account is created until the code is used.",
    ],
  }),

  "account.password_reset_code": (d) => ({
    subject: `${s(d, "code")} is your Calder password reset code`,
    preheader: "Use this code to set a new password.",
    heading: "Reset your password",
    intro: [
      "Enter this code to set a new password. It expires in " +
        `${s(d, "expiresInMinutes", "10")} minutes and can be used once.`,
    ],
    code: s(d, "code"),
    codeCaption: "Six digits, no spaces",
    callout: {
      tone: "warning",
      title: "Didn't ask for this?",
      body: "Someone may have typed your address by mistake. Ignore this email — your password stays unchanged unless this code is used.",
    },
  }),

  "account.password_changed": (d, u) => ({
    subject: "Your Calder password was changed",
    preheader: "If this wasn't you, secure your account now.",
    heading: "Password changed",
    intro: [
      "Your Calder password was changed. You are still signed in on this device; other sessions keep working until they expire.",
    ],
    details: [
      { label: "When", value: s(d, "when", "just now") },
      { label: "IP address", value: s(d, "ip", "not recorded") },
    ],
    callout: {
      tone: "danger",
      title: "Wasn't you?",
      body: "Reset your password immediately and sign out of all sessions. Then reply to this email so we can look at the account.",
    },
    cta: { label: "Review active sessions", url: `${u.dashboard}/settings` },
  }),

  "account.password_reset_completed": (d, u) => ({
    subject: "Your Calder password was reset",
    preheader: "Every other session has been signed out.",
    heading: "Password reset",
    intro: [
      "Your password was reset with a recovery code. As a precaution, every other session was signed out.",
    ],
    details: [
      { label: "When", value: s(d, "when", "just now") },
      { label: "IP address", value: s(d, "ip", "not recorded") },
    ],
    callout: {
      tone: "danger",
      title: "Wasn't you?",
      body: "Somebody with access to your inbox may have reset it. Reply to this email immediately.",
    },
    cta: { label: "Sign in and review", url: `${u.dashboard}/settings` },
  }),

  "account.new_sign_in": (d, u) => ({
    subject: "New sign-in to your Calder account",
    preheader: "Check the device and location.",
    heading: "New sign-in",
    intro: ["A new sign-in to your Calder account was completed."],
    details: [
      { label: "When", value: s(d, "when", "just now") },
      { label: "Method", value: s(d, "method", "password") },
      { label: "IP address", value: s(d, "ip", "not recorded") },
      { label: "Device", value: s(d, "device", "unknown browser") },
    ],
    cta: { label: "Review sessions", url: `${u.dashboard}/settings` },
    outro: [
      "If this was you, nothing to do. If not, reset your password and sign out everywhere — that ends every session immediately.",
    ],
  }),

  "account.sessions_revoked": (d, u) => ({
    subject: "Every Calder session was signed out",
    preheader: "All devices must sign in again.",
    heading: "All sessions signed out",
    intro: [
      "Every session on your Calder account was signed out. Each device will need to sign in again.",
    ],
    details: [
      { label: "When", value: s(d, "when", "just now") },
      { label: "Reason", value: s(d, "reason", "requested from account settings") },
    ],
    callout: {
      tone: "warning",
      title: "Unexpected?",
      body: "Somebody may have your password. Reset it and reply to this email.",
    },
    cta: { label: "Sign in", url: `${u.dashboard}/login` },
  }),

  "account.two_factor_enabled": (d, u) => ({
    subject: "Two-factor authentication is on",
    preheader: "Your account now needs a second factor to sign in.",
    heading: "Two-factor authentication enabled",
    intro: [
      "Two-factor authentication is now required to sign in to your Calder account. Keep your recovery codes somewhere safe and offline.",
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    cta: { label: "Review security settings", url: `${u.dashboard}/settings` },
  }),

  "account.two_factor_disabled": (d, u) => ({
    subject: "Two-factor authentication is off",
    preheader: "Your account is protected by a password alone.",
    heading: "Two-factor authentication disabled",
    intro: [
      "Two-factor authentication was switched off. From now on your password alone can open the account.",
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    callout: {
      tone: "danger",
      title: "Wasn't you?",
      body: "Turn it back on and reset your password. Then reply to this email.",
    },
    cta: { label: "Security settings", url: `${u.dashboard}/settings` },
  }),

  "account.recovery_codes_generated": (d, u) => ({
    subject: "New two-factor recovery codes",
    preheader: "The previous set no longer works.",
    heading: "New recovery codes",
    intro: [
      `${s(d, "count", "10")} new recovery codes were generated. The previous set stopped working the moment these were created.`,
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    outro: ["Store them offline. Each code works once."],
    cta: { label: "Security settings", url: `${u.dashboard}/settings` },
  }),

  "account.sign_in_method_added": (d, u) => ({
    subject: "A sign-in method was added to Calder",
    preheader: `${s(d, "provider", "An OAuth provider")} can now sign in to your account.`,
    heading: "Sign-in method added",
    intro: [
      `${s(d, "provider", "An OAuth provider")} is now connected to your Calder account and can be used to sign in.`,
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    callout: {
      tone: "warning",
      title: "Wasn't you?",
      body: "Disconnect it from settings and reset your password.",
    },
    cta: { label: "Review sign-in methods", url: `${u.dashboard}/settings` },
  }),

  "account.sign_in_method_removed": (d, u) => ({
    subject: "A sign-in method was removed from Calder",
    preheader: `${s(d, "provider", "An OAuth provider")} can no longer sign in.`,
    heading: "Sign-in method removed",
    intro: [
      `${s(d, "provider", "An OAuth provider")} was disconnected from your Calder account. If it was your only OAuth method, sign in with your password or a magic link.`,
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    cta: { label: "Review sign-in methods", url: `${u.dashboard}/settings` },
  }),

  "account.email_change_requested": (d, u) => ({
    subject: "Confirm your new Calder email address",
    preheader: "One click confirms the change.",
    heading: "Confirm your new address",
    intro: [
      `We received a request to change the email on your Calder account to ${s(d, "newEmail")}. Confirm it below. The link expires in ${s(d, "expiresInHours", "24")} hours.`,
    ],
    cta: { label: "Confirm new address", url: s(d, "confirmUrl", u.dashboard) },
    outro: ["If you did not ask for this, ignore this email and nothing changes."],
  }),

  "account.email_changed": (d) => ({
    subject: "Your Calder email address was changed",
    preheader: "This notice goes to the previous address.",
    heading: "Your email address changed",
    intro: [
      `The email on your Calder account was changed from ${s(d, "oldEmail")} to ${s(d, "newEmail")}.`,
      "We are telling the old address as well as the new one, so a change you did not make cannot go unnoticed.",
    ],
    details: [{ label: "When", value: s(d, "when", "just now") }],
    callout: {
      tone: "danger",
      title: "Wasn't you?",
      body: "Reply to this email immediately. We can restore the previous address.",
    },
  }),

  "account.locked_out": (d, u) => ({
    subject: "Too many sign-in attempts on your Calder account",
    preheader: "Sign-in is paused for a short while.",
    heading: "Sign-in temporarily locked",
    intro: [
      `After ${s(d, "attempts", "several")} failed attempts, sign-in to your account is paused until ${s(d, "lockedUntil", "shortly")}. This slows down password guessing; it does not mean your account was accessed.`,
    ],
    details: [{ label: "Last IP address", value: s(d, "ip", "not recorded") }],
    cta: { label: "Reset your password", url: `${u.dashboard}/login` },
  }),

  "account.suspicious_sign_in_blocked": (d, u) => ({
    subject: "A sign-in to Calder was blocked",
    preheader: "We stopped an unusual sign-in.",
    heading: "Sign-in blocked",
    intro: [
      "We blocked a sign-in that did not look like your usual activity. Nobody got into the account.",
    ],
    details: [
      { label: "When", value: s(d, "when", "just now") },
      { label: "IP address", value: s(d, "ip", "not recorded") },
      { label: "Why", value: s(d, "reason", "unusual location or device") },
    ],
    cta: { label: "Review security settings", url: `${u.dashboard}/settings` },
    outro: ["If this was you, sign in again and confirm the device."],
  }),

  "account.deletion_scheduled": (d, u) => ({
    subject: "Your Calder account is scheduled for deletion",
    preheader: `Deletes on ${s(d, "deletesOn")}.`,
    heading: "Account deletion scheduled",
    intro: [
      `Your account and everything in it will be deleted on ${s(d, "deletesOn")}. Until then you can cancel and keep everything.`,
      "Sending stops immediately. API keys are revoked. Deliveries and audit history are removed with the workspace.",
    ],
    cta: { label: "Cancel deletion", url: s(d, "cancelUrl", `${u.dashboard}/settings`) },
  }),

  "account.deleted": () => ({
    subject: "Your Calder account has been deleted",
    preheader: "This is the last email we will send you.",
    heading: "Account deleted",
    intro: [
      "Your Calder account and its data have been deleted. API keys, domains, senders and delivery history are gone.",
      "Billing records are kept for the period accounting law requires. If you did not request this, reply immediately — we hold limited backups for a short window.",
    ],
  }),

  "account.data_export_ready": (d) => ({
    subject: "Your Calder data export is ready",
    preheader: "The download link expires.",
    heading: "Your export is ready",
    intro: ["The copy of your Calder data you requested is ready to download."],
    details: [{ label: "Valid for", value: `${s(d, "expiresInHours", "24")} hours` }],
    cta: { label: "Download the archive", url: s(d, "downloadUrl") },
  }),

  "account.data_export_failed": (d, u) => ({
    subject: "Your Calder data export could not be completed",
    preheader: "Nothing was lost — we can try again.",
    heading: "Export failed",
    intro: [
      `We could not produce the export you requested on ${s(d, "requestedAt", "recently")}. No data was deleted or changed by the attempt.`,
      "Reply to this email and we will run it again by hand.",
    ],
    cta: { label: "Contact support", url: s(d, "supportUrl", u.support) },
  }),

  /* ── Organization ───────────────────────────────────────────────────── */
  "organization.invitation": (d, u) => ({
    subject: `${s(d, "inviterName", "Someone")} invited you to ${s(d, "organizationName", "a Calder workspace")}`,
    preheader: `You have been added as ${s(d, "role", "a member")}.`,
    heading: "You have an invitation",
    intro: [
      `${s(d, "inviterName", "A teammate")} invited you to join ${s(d, "organizationName", "their workspace")} on Calder as ${s(d, "role", "a member")}.`,
      "Calder is email infrastructure: transactional and broadcast sending, deliverability, and the logs that prove what happened.",
    ],
    details: [
      { label: "Workspace", value: s(d, "organizationName") },
      { label: "Role", value: s(d, "role", "member") },
      { label: "Invitation expires in", value: `${s(d, "expiresInDays", "7")} days` },
    ],
    cta: { label: "Accept the invitation", url: s(d, "acceptUrl", u.dashboard) },
    outro: ["If you don't know this workspace, ignore this email and nothing happens."],
  }),

  "organization.invitation_reminder": (d, u) => ({
    subject: `Reminder: your invitation to ${s(d, "organizationName", "a Calder workspace")}`,
    preheader: `Expires in ${s(d, "expiresInDays", "3")} days.`,
    heading: "Your invitation is still open",
    intro: [
      `${s(d, "inviterName", "A teammate")} invited you to ${s(d, "organizationName", "their workspace")} and the invitation has not been accepted yet.`,
    ],
    cta: { label: "Accept the invitation", url: s(d, "acceptUrl", u.dashboard) },
    outro: [
      "If you would rather not join, ignore this email and the invitation expires on its own.",
    ],
  }),

  "organization.invitation_accepted": (d, u) => ({
    subject: `${s(d, "memberName", s(d, "memberEmail", "Someone"))} joined ${s(d, "organizationName", "your workspace")}`,
    preheader: "The invitation was accepted.",
    heading: "Invitation accepted",
    intro: [
      `${s(d, "memberName", s(d, "memberEmail", "Someone"))} accepted your invitation and is now part of ${s(d, "organizationName", "your workspace")}.`,
    ],
    details: [{ label: "Email", value: s(d, "memberEmail") }],
    cta: { label: "Manage the team", url: `${u.dashboard}/settings` },
  }),

  "organization.role_changed": (d, u) => ({
    subject: `Your role in ${s(d, "organizationName", "a workspace")} changed`,
    preheader: `${s(d, "oldRole", "your previous role")} → ${s(d, "newRole", "a new role")}`,
    heading: "Your role changed",
    intro: [
      `Your role in ${s(d, "organizationName", "the workspace")} changed from ${s(d, "oldRole", "the previous role")} to ${s(d, "newRole", "a new role")}. Permissions change with it immediately.`,
    ],
    details: [{ label: "Changed by", value: s(d, "changedBy", "a workspace owner") }],
    cta: { label: "Open the workspace", url: u.dashboard },
  }),

  "organization.member_removed": (d) => ({
    subject: `You were removed from ${s(d, "organizationName", "a workspace")}`,
    preheader: "Access to that workspace has ended.",
    heading: "You were removed from a workspace",
    intro: [
      `${s(d, "removedBy", "An owner")} removed you from ${s(d, "organizationName", "the workspace")}. You no longer have access to its projects, senders or delivery history.`,
      "Any other workspace you belong to is unaffected.",
    ],
  }),

  "organization.ownership_transferred": (d, u) => ({
    subject: `Ownership of ${s(d, "organizationName", "a workspace")} changed`,
    preheader: "The new owner has full control.",
    heading: "Workspace ownership transferred",
    intro: [
      `Ownership of ${s(d, "organizationName", "the workspace")} moved ${s(d, "direction", "to a new owner")}. ${s(d, "otherParty")} is now the owner.`,
    ],
    cta: { label: "Open the workspace", url: u.dashboard },
  }),

  "organization.workspace_created": (d, u) => ({
    subject: `${s(d, "organizationName", "Your workspace")} is ready`,
    preheader: "Add a domain, a key and your first send.",
    heading: "Workspace created",
    intro: [
      `${s(d, "organizationName", "Your workspace")} is set up${s(d, "projectName") ? ` with the ${s(d, "projectName")} project` : ""}.`,
      "A project holds its own API keys, senders, suppressions and delivery log, so development and production can stay apart.",
    ],
    cta: { label: "Open the workspace", url: u.dashboard },
  }),

  /* ── Billing ────────────────────────────────────────────────────────── */
  "billing.trial_started": (d, u) => ({
    subject: `Your ${s(d, "planName", "Calder")} trial has started`,
    preheader: `Runs until ${s(d, "trialEndsOn")}.`,
    heading: "Your trial has started",
    intro: [
      `You are on the ${s(d, "planName", "Calder")} plan for the next few days, with everything included.`,
      `The trial ends on ${s(d, "trialEndsOn")}. We will email you before it does — nothing is charged automatically until you add a payment method.`,
    ],
    details: [
      { label: "Plan", value: s(d, "planName") },
      { label: "Trial ends", value: s(d, "trialEndsOn") },
      { label: "Monthly allowance", value: s(d, "emailLimit", "as per plan") },
    ],
    cta: { label: "View plans and usage", url: `${u.dashboard}/usage` },
  }),

  "billing.trial_ending": (d, u) => ({
    subject: `Your trial ends on ${s(d, "trialEndsOn")}`,
    preheader: "Add a payment method to keep sending.",
    heading: "Your trial ends in three days",
    intro: [
      `Your ${s(d, "planName", "Calder")} trial ends on ${s(d, "trialEndsOn")}. If you add a payment method before then, nothing is interrupted.`,
      "Without one, the workspace drops to the Beginner plan: 5,000 emails a month and fewer projects, senders and seats.",
    ],
    details: [
      {
        label: "Plan after trial",
        value: `${s(d, "planName")} · ₦${s(d, "priceNgn", "—")} or $${s(d, "priceUsd", "—")} a month`,
      },
      { label: "Trial ends", value: s(d, "trialEndsOn") },
    ],
    cta: { label: "Add a payment method", url: `${u.dashboard}/usage` },
  }),

  "billing.trial_ended": (d, u) => ({
    subject: "Your Calder trial has ended",
    preheader: "Here is the plan you are on now.",
    heading: "Your trial ended",
    intro: [
      `The trial is over and the workspace is now on the ${s(d, "planName", "Beginner")} plan with ${s(d, "emailLimit", "its monthly allowance")}. Everything you built is still here.`,
    ],
    cta: { label: "Compare plans", url: `${u.dashboard}/usage` },
  }),

  "billing.payment_succeeded": (d, u) => ({
    subject: `Receipt: ${s(d, "amount")} for ${s(d, "planName", "Calder")}`,
    preheader: `Paid on ${s(d, "paidOn")}.`,
    heading: "Payment received",
    intro: [
      `We received ${s(d, "amount")} for the ${s(d, "planName", "Calder")} plan. Your allowance reset with the payment.`,
    ],
    details: [
      { label: "Amount", value: s(d, "amount") },
      { label: "Plan", value: s(d, "planName") },
      { label: "Paid on", value: s(d, "paidOn") },
      { label: "Reference", value: s(d, "reference", "—") },
    ],
    cta: { label: "View the invoice", url: s(d, "invoiceUrl", `${u.dashboard}/usage`) },
    outro: ["Keep this email as your receipt. Invoices are also available in the dashboard."],
  }),

  "billing.payment_failed": (d, u) => ({
    subject: `Payment of ${s(d, "amount")} failed`,
    preheader: "Sending continues for now. Please update your card.",
    heading: "We couldn't take the payment",
    intro: [
      `The ${s(d, "amount")} charge for ${s(d, "planName", "your Calder plan")} did not go through. This is usually an expired card, a limit, or a bank declining the transaction.`,
      `We will try again on ${s(d, "retryOn", "the next scheduled attempt")}. Your sending is not paused yet.`,
    ],
    details: [
      { label: "Amount", value: s(d, "amount") },
      { label: "Next attempt", value: s(d, "retryOn", "in 3 days") },
    ],
    cta: { label: "Update payment method", url: s(d, "updateUrl", `${u.dashboard}/usage`) },
  }),

  "billing.payment_failed_final": (d, u) => ({
    subject: "Final notice: your Calder plan will be downgraded",
    preheader: `On ${s(d, "downgradeOn")} sending stops at the paid level.`,
    heading: "Last attempt failed",
    intro: [
      `We tried ${s(d, "amount")} for the ${s(d, "planName", "Calder")} plan again and it was declined. Unless a payment succeeds, the workspace moves to the Beginner plan on ${s(d, "downgradeOn")}.`,
      "Everything you built is kept. What changes is the ceiling: 5,000 emails a month, fewer projects, senders and seats. Anything above those limits stops being creatable, and sending stops when the allowance is used.",
    ],
    cta: { label: "Update payment method", url: s(d, "updateUrl", `${u.dashboard}/usage`) },
    outro: ["If you are closing the account on purpose, no action is needed."],
  }),

  "billing.invoice_ready": (d) => ({
    subject: `Invoice ${s(d, "invoiceNumber")} from Calder`,
    preheader: `${s(d, "amount")} due ${s(d, "dueOn")}.`,
    heading: "Your invoice is ready",
    intro: [`Invoice ${s(d, "invoiceNumber")} for ${s(d, "amount")} is available.`],
    details: [
      { label: "Invoice", value: s(d, "invoiceNumber") },
      { label: "Amount", value: s(d, "amount") },
      { label: "Due", value: s(d, "dueOn") },
    ],
    cta: { label: "Open the invoice", url: s(d, "invoiceUrl") },
  }),

  "billing.plan_upgraded": (d, u) => ({
    subject: `You're now on ${s(d, "newPlan", "a new plan")}`,
    preheader: "The higher limits are live.",
    heading: "Plan upgraded",
    intro: [
      `Your workspace moved from ${s(d, "oldPlan", "the previous plan")} to ${s(d, "newPlan", "its new plan")}. The new ceilings apply immediately.`,
    ],
    details: [
      { label: "Plan", value: s(d, "newPlan") },
      { label: "Monthly emails", value: s(d, "emailLimit", "as per plan") },
      { label: "Effective", value: s(d, "effectiveOn", "now") },
    ],
    cta: { label: "View usage", url: `${u.dashboard}/usage` },
  }),

  "billing.plan_downgraded": (d, u) => ({
    subject: `Your plan changed to ${s(d, "newPlan", "a smaller plan")}`,
    preheader: "Here is exactly what changes.",
    heading: "Plan changed",
    intro: [
      `Your workspace moved from ${s(d, "oldPlan", "the previous plan")} to ${s(d, "newPlan", "its new plan")}, effective ${s(d, "effectiveOn", "now")}.`,
    ],
    details: [
      { label: "New monthly allowance", value: s(d, "emailLimit", "as per plan") },
      { label: "What is kept", value: "Your projects, domains, senders and history" },
    ],
    callout: {
      tone: "warning",
      title: "If you are over the new limits",
      body:
        s(d, "overLimitNote") ||
        "Nothing is deleted. You cannot create new resources beyond the new ceiling, and sending pauses when the monthly allowance is used.",
    },
    cta: { label: "Compare plans", url: `${u.dashboard}/usage` },
  }),

  "billing.subscription_canceled": (d, u) => ({
    subject: "Your Calder subscription is cancelled",
    preheader: `Access continues until ${s(d, "accessUntil")}.`,
    heading: "Subscription cancelled",
    intro: [
      `The ${s(d, "planName", "Calder")} subscription is cancelled. Nothing else is charged and access continues until ${s(d, "accessUntil")}.`,
      "After that date the workspace moves to the Beginner plan. Your projects, domains and history stay.",
    ],
    cta: { label: "Reactivate", url: `${u.dashboard}/usage` },
  }),

  "billing.subscription_reactivated": (d, u) => ({
    subject: "Your Calder subscription is active again",
    preheader: `Renews on ${s(d, "renewsOn")}.`,
    heading: "Subscription resumed",
    intro: [
      `The ${s(d, "planName", "Calder")} subscription is active again and renews on ${s(d, "renewsOn")}.`,
    ],
    cta: { label: "View usage", url: `${u.dashboard}/usage` },
  }),

  "billing.refund_issued": (d, u) => ({
    subject: `Refund of ${s(d, "amount")} issued`,
    preheader: "It can take a few days to appear.",
    heading: "Refund issued",
    intro: [
      `We issued a refund of ${s(d, "amount")}. Depending on your bank it appears in ${s(d, "daysToSettle", "5–10")} business days.`,
    ],
    details: [
      { label: "Amount", value: s(d, "amount") },
      { label: "Reference", value: s(d, "reference", "—") },
    ],
    cta: { label: "Billing settings", url: `${u.dashboard}/usage` },
  }),

  "billing.payment_method_expiring": (d) => ({
    subject: "The card on your Calder account expires soon",
    preheader: `Ending ${s(d, "lastFour")}.`,
    heading: "Your card is about to expire",
    intro: [
      `The card ending ${s(d, "lastFour")} expires ${s(d, "expiryMonth")}/${s(d, "expiryYear")}. Update it to avoid a failed payment.`,
    ],
    cta: { label: "Update payment method", url: s(d, "updateUrl") },
  }),

  /* ── Usage ──────────────────────────────────────────────────────────── */
  "usage.warning_80": (d, u) => ({
    subject: `You've used ${s(d, "percent", "80")}% of this month's emails`,
    preheader: `${s(d, "used")} of ${s(d, "limit")} sent. Resets ${s(d, "resetsOn")}.`,
    heading: "Eighty percent used",
    intro: [
      `The ${s(d, "planName", "Calder")} plan allows ${s(d, "limit")} emails a month and ${s(d, "used")} have been accepted. That is ${s(d, "percent", "80")}% of the allowance, with the period resetting on ${s(d, "resetsOn")}.`,
      "Nothing has stopped. This is the point to upgrade if the rest of the month looks busy.",
    ],
    cta: { label: "View usage", url: `${u.dashboard}/usage` },
  }),

  "usage.exhausted_100": (d, u) => ({
    subject: "This month's email allowance is used up",
    preheader: "Sending is blocked until the period resets.",
    heading: "Allowance exhausted",
    intro: [
      `All ${s(d, "limit")} emails on the ${s(d, "planName", "Calder")} plan have been accepted. New sends are refused with plan_limit_reached until the period resets on ${s(d, "resetsOn")}.`,
      "Queued messages already accepted are still delivered. Test-key sends are not affected.",
    ],
    callout: {
      tone: "warning",
      title: "Need to keep sending today?",
      body: "Upgrading raises the ceiling immediately and resets the allowance for the new plan.",
    },
    cta: { label: "Compare plans", url: s(d, "pricingUrl", `${u.dashboard}/usage`) },
  }),

  "usage.reset": (d, u) => ({
    subject: "Your monthly allowance has reset",
    preheader: `${s(d, "limit")} emails available until ${s(d, "periodEnd")}.`,
    heading: "New period, fresh allowance",
    intro: [
      `The new billing period started on ${s(d, "periodStart")}. The ${s(d, "planName", "Calder")} plan has ${s(d, "limit")} emails available until ${s(d, "periodEnd")}.`,
    ],
    cta: { label: "View usage", url: `${u.dashboard}/usage` },
  }),

  "usage.resource_limit": (d, u) => ({
    subject: `You've reached the ${s(d, "resource", "plan")} limit on ${s(d, "planName", "Calder")}`,
    preheader: `Limit: ${s(d, "limit")}. Existing resources are untouched.`,
    heading: "Plan limit reached",
    intro: [
      `The ${s(d, "planName", "Calder")} plan includes ${s(d, "limit")} ${s(d, "resource", "resources")} and you already have that many. Nothing you have was removed — you simply cannot add another until you are under the ceiling or change plan.`,
      s(d, "upgradePlan") ? `The next plan up, ${s(d, "upgradePlan")}, raises this limit.` : "",
    ].filter(Boolean),
    cta: { label: "Compare plans", url: `${u.dashboard}/usage` },
  }),

  /* ── Operations ─────────────────────────────────────────────────────── */
  "operations.domain_verified": (d, u) => ({
    subject: `${s(d, "domain")} is verified`,
    preheader: "You can send from it now.",
    heading: "Domain verified",
    intro: [
      `${s(d, "domain")} passed DNS verification and is ready to send from. Create a sender on it and your mail leaves with your own DKIM and SPF alignment.`,
    ],
    details: [
      { label: "Domain", value: s(d, "domain") },
      { label: "Project", value: s(d, "projectName", "—") },
    ],
    cta: { label: "Create a sender", url: `${u.dashboard}/senders` },
  }),

  "operations.domain_failed": (d, u) => ({
    subject: `${s(d, "domain")} failed verification`,
    preheader: "One DNS record is usually the cause.",
    heading: "Domain verification failed",
    intro: [
      `We checked the DNS records for ${s(d, "domain")} and they are not what we expect yet. Until they match, mail cannot be sent from this domain.`,
    ],
    details: [
      { label: "Domain", value: s(d, "domain") },
      { label: "Reason", value: s(d, "reason", "records not found or not matching") },
    ],
    callout: {
      tone: "info",
      title: "What usually fixes it",
      body: "DNS changes can take up to an hour to propagate. Check the exact DKIM and SPF values, then re-check the domain.",
    },
    cta: { label: "Open DNS records", url: s(d, "recordsUrl", `${u.dashboard}/domains`) },
  }),

  "operations.domain_dns_lost": (d, u) => ({
    subject: `${s(d, "domain")} is no longer verified`,
    preheader: "Sending from this domain will fail.",
    heading: "Domain lost its DNS records",
    intro: [
      `A routine re-check found that ${s(d, "domain")} no longer has the records that verified it. New sends from senders on this domain will fail until it is verified again.`,
    ],
    cta: { label: "Review DNS records", url: s(d, "recordsUrl", `${u.dashboard}/domains`) },
  }),

  "operations.api_key_created": (d, u) => ({
    subject: "A new API key was created",
    preheader: `${s(d, "keyName", "A key")} · ${s(d, "env", "live")}`,
    heading: "API key created",
    intro: ["A new API key was created for your workspace."],
    details: [
      { label: "Name", value: s(d, "keyName", "—") },
      { label: "Prefix", value: `${s(d, "keyPrefix")}…` },
      { label: "Environment", value: s(d, "env", "—") },
      { label: "Created by", value: s(d, "createdBy", "—") },
      { label: "When", value: s(d, "when", "just now") },
    ],
    outro: [
      "We never store the full key, so this email cannot show it. If you did not create it, revoke it now.",
    ],
    cta: { label: "Manage API keys", url: `${u.dashboard}/keys` },
  }),

  "operations.api_key_revoked": (d, u) => ({
    subject: "An API key was revoked",
    preheader: `${s(d, "keyName", "A key")} no longer works.`,
    heading: "API key revoked",
    intro: [
      "An API key was revoked. Requests using it fail immediately with authentication_error. Messages already accepted are still delivered.",
    ],
    details: [
      { label: "Name", value: s(d, "keyName", "—") },
      { label: "Prefix", value: `${s(d, "keyPrefix")}…` },
      { label: "Environment", value: s(d, "env", "—") },
      { label: "Revoked by", value: s(d, "revokedBy", "—") },
    ],
    cta: { label: "Manage API keys", url: `${u.dashboard}/keys` },
  }),

  "operations.api_key_expiring": (d, u) => ({
    subject: `API key ${s(d, "keyName", "")} expires on ${s(d, "expiresOn")}`,
    preheader: "Rotate it before then.",
    heading: "API key expiring soon",
    intro: [
      `The key ${s(d, "keyName", "on your workspace")} (${s(d, "keyPrefix")}…) stops working on ${s(d, "expiresOn")}. Rotate it now and deploy the replacement before that date.`,
    ],
    cta: { label: "Rotate the key", url: `${u.dashboard}/keys` },
  }),

  "operations.webhook_failing": (d, u) => ({
    subject: "A webhook endpoint is failing",
    preheader: `${s(d, "endpointUrl")} exhausted its retries.`,
    heading: "Webhook delivery failed",
    intro: [
      `We could not deliver ${s(d, "event", "an event")} to ${s(d, "endpointUrl")} after every retry. The delivery is recorded as failed and will not be sent again.`,
    ],
    details: [
      { label: "Endpoint", value: s(d, "endpointUrl") },
      { label: "Event", value: s(d, "event", "—") },
      { label: "Last error", value: s(d, "lastError", "no response") },
    ],
    outro: [
      "Check that the endpoint returns 2xx within ten seconds and that its signing secret is current.",
    ],
    cta: { label: "Open webhooks", url: `${u.dashboard}/webhooks` },
  }),

  "operations.webhook_disabled": (d, u) => ({
    subject: "A webhook endpoint was disabled",
    preheader: `${s(d, "failureCount")} deliveries failed in a row.`,
    heading: "Webhook disabled",
    intro: [
      `${s(d, "endpointUrl")} failed ${s(d, "failureCount")} deliveries in a row, so we stopped sending to it. Endpoints that keep failing slow the whole delivery queue down.`,
      "Fix the endpoint, then turn it back on. Events generated while it was off are not replayed automatically.",
    ],
    cta: { label: "Re-enable the endpoint", url: s(d, "reenableUrl", `${u.dashboard}/webhooks`) },
  }),

  "operations.broadcast_completed": (d, u) => ({
    subject: `${s(d, "broadcastName", "Your broadcast")} finished sending`,
    preheader: `${s(d, "recipients")} recipients.`,
    heading: "Broadcast complete",
    intro: [
      `${s(d, "broadcastName", "Your broadcast")} has finished sending to ${s(d, "recipients")} recipients.`,
    ],
    details: [
      { label: "Delivered", value: s(d, "delivered", "—") },
      { label: "Bounced", value: s(d, "bounced", "—") },
      { label: "Unsubscribed", value: s(d, "unsubscribed", "—") },
    ],
    cta: { label: "Open the report", url: s(d, "reportUrl", `${u.dashboard}/broadcasts`) },
  }),

  "operations.broadcast_paused": (d, u) => ({
    subject: `${s(d, "broadcastName", "A broadcast")} was paused automatically`,
    preheader: s(d, "reason", "A safety threshold was crossed."),
    heading: "Broadcast paused",
    intro: [
      `${s(d, "broadcastName", "Your broadcast")} was paused because ${s(d, "reason", "a safety threshold was crossed")}. Pausing protects your domain reputation: continuing would have sent the problem to the rest of the list.`,
    ],
    details: [
      { label: "Sent so far", value: s(d, "sent", "—") },
      { label: "Bounced", value: s(d, "bounced", "—") },
      { label: "Complained", value: s(d, "complained", "—") },
    ],
    outro: ["Fix the list or the content, then resume from the report page."],
    cta: { label: "Open the broadcast", url: s(d, "reportUrl", `${u.dashboard}/broadcasts`) },
  }),

  "operations.bounce_rate_warning": (d, u) => ({
    subject: `Bounce rate is ${s(d, "bounceRate")} over the last ${s(d, "window", "7 days")}`,
    preheader: "High bounces damage delivery for every customer on your domain.",
    heading: "Bounce rate warning",
    intro: [
      `Your workspace bounced ${s(d, "bounceRate")} of its mail over the last ${s(d, "window", "7 days")}. Above roughly five percent, mailbox providers start treating your domain as a source of unwanted mail.`,
      s(d, "topReason") ? `The most common reason is "${s(d, "topReason")}".` : "",
    ].filter(Boolean),
    cta: { label: "Review suppressions", url: `${u.dashboard}/suppressions` },
  }),

  "operations.complaint_rate_warning": (d, u) => ({
    subject: `Complaint rate is ${s(d, "complaintRate")} over the last ${s(d, "window", "7 days")}`,
    preheader: "Complaints are the fastest way to lose a sending domain.",
    heading: "Complaint rate warning",
    intro: [
      `Recipients marked ${s(d, "complaintRate")} of your recent mail as spam. That is above the level mailbox providers tolerate, and it affects every project on the workspace.`,
      "Check who received the message and whether they expected it. Complaints usually mean consent was assumed rather than collected.",
    ],
    cta: { label: "Review suppressions", url: `${u.dashboard}/suppressions` },
  }),

  /* ── Legal ──────────────────────────────────────────────────────────── */
  "legal.policy_update": (d, u) => ({
    subject: `We're updating our ${s(d, "document", "policy")}`,
    preheader: `Takes effect ${s(d, "effectiveOn")}.`,
    heading: `Changes to our ${s(d, "document", "policy")}`,
    intro: [
      `We are updating our ${s(d, "document", "policy")}. The new version takes effect on ${s(d, "effectiveOn")}.`,
      s(d, "summary", "The changes are described in the document."),
    ],
    cta: { label: "Read the new version", url: s(d, "policyUrl", u.app) },
    outro: [
      "We send this notice because the change affects what we do with your data or what you agree to. Account, billing and security mail is unaffected.",
    ],
  }),

  /* ── Optional ───────────────────────────────────────────────────────── */
  "updates.product_update": (d, u) => ({
    subject: s(d, "title", "What's new in Calder"),
    preheader: s(d, "body", "A short update from the team.").slice(0, 120),
    heading: s(d, "title", "What's new in Calder"),
    intro: [s(d, "body", "")].filter(Boolean),
    cta: s(d, "ctaUrl") ? { label: s(d, "ctaLabel", "Read more"), url: s(d, "ctaUrl") } : undefined,
    footnote:
      "You receive product updates because you opted in. Account, billing and security mail is separate.",
    linkLine: {
      text: "Prefer fewer emails?",
      label: "Manage what you receive",
      url: u.preferences,
    },
  }),

  "updates.monthly_digest": (d, u) => ({
    subject: `Your Calder recap for ${s(d, "period", "last month")}`,
    preheader: `${s(d, "sent", "0")} emails sent · ${s(d, "bounceRate", "0%")} bounced`,
    heading: `${s(d, "period", "Last month")} in review`,
    intro: [s(d, "highlights", "Here is what happened across your workspace.")],
    details: [
      { label: "Emails sent", value: s(d, "sent", "0") },
      { label: "Delivered", value: s(d, "delivered", "0") },
      { label: "Bounce rate", value: s(d, "bounceRate", "0%") },
      { label: "Busiest sender", value: s(d, "topSender", "—") },
    ],
    cta: { label: "Open analytics", url: `${u.dashboard}/analytics` },
    footnote: "This recap is optional. Account, billing and security mail is separate.",
    linkLine: {
      text: "Prefer fewer emails?",
      label: "Manage what you receive",
      url: u.preferences,
    },
  }),

  "updates.announcement": (d, u) => ({
    subject: s(d, "title", "An announcement from Calder"),
    preheader: s(d, "body", "").slice(0, 120),
    heading: s(d, "title", "An announcement from Calder"),
    intro: [s(d, "body", "")].filter(Boolean),
    cta: s(d, "ctaUrl") ? { label: s(d, "ctaLabel", "Read more"), url: s(d, "ctaUrl") } : undefined,
    footnote:
      "You receive announcements because you opted in. Account, billing and security mail is separate.",
    linkLine: {
      text: "Prefer fewer emails?",
      label: "Manage what you receive",
      url: u.preferences,
    },
  }),
};
