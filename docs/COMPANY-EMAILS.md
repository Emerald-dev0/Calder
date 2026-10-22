# Company email — what Calder sends, and what actually fires

Calder mails its own users through one package (`@calder/notify`), one table
(`company_emails`) and one catalogue (`packages/notify/src/catalogue.ts`).
Company mail never enters `emails`: it must not be metered as a customer send,
must not appear in a tenant's delivery log, and must not inherit a tenant's
suppression rules.

This page is the honest inventory. "Wired" means a code path in this repository
sends it today. Everything under **Not wired** has copy, a preview and a
template — and no trigger, because the feature it reports on does not exist yet.
A template with no trigger is a promise; this page keeps us from pretending it
is a feature.

## Rules the system enforces

| Rule | Where |
| --- | --- |
| An unknown template id throws before anything is written | `send.ts` → `companyEmailDefinition` |
| `updates` and `digest` are the only opt-out categories | `catalogue.ts` → `OPTIONAL_CATEGORIES` |
| A mandatory category can never be opted out, even by a hand-written row | `preferences.ts` → `isCategoryDisabled` |
| Optional mail carries `List-Unsubscribe` + RFC 8058 one-click | `send.ts` |
| The unsubscribe link is signed per (user, category) and cannot enable anything | `tokens.ts` |
| A GET on the unsubscribe link never changes state | `app/api/unsubscribe/company/route.ts` |
| One row per attempt, written before the provider call | `company_emails` |
| A repeated event collapses onto the first row (unique `idempotency_key`) | `company_emails_idempotency_unique` |
| Provider errors are stored as a class, never the response body | `send.ts` → `scrubError` |
| Codes, tokens and links never reach `metadata` | `send.ts` → `safeMetadata` |
| Delivery failure never fails the operation that caused it | `sendCompanyEmailQuietly` |
| Workspace mail goes to owners and admins, not every member | `recipients.ts` |

## Wired (24)

| Id | Fires from | Key |
| --- | --- | --- |
| `account.verification_code` | signup / resend (`api/auth/email-code`) | `otp:verification:<email>:<code>` |
| `account.password_reset_code` | reset request (`lib/send-auth-email.ts`) | `otp:reset:<email>:<code>` |
| `account.welcome` | first verification (`api/auth/email-code/verify`) | per user |
| `account.new_sign_in` | login, magic link, OAuth callback | per sign-in |
| `account.password_changed` | `api/auth/password-change` | per change |
| `account.password_reset_completed` | `api/auth/password-reset` | per reset |
| `account.sign_in_method_added` | OAuth callback | per provider link |
| `account.sign_in_method_removed` | `api/auth/oauth/disconnect` | per provider unlink |
| `account.sessions_revoked` | `signOutOtherSessions()` | per event |
| `organization.invitation` | `inviteMember()` | `invite:<invitationId>` |
| `organization.invitation_reminder` | cron `/v1/cron/company-email` | `<invitationId>:<expiresAt>` |
| `organization.invitation_accepted` | verification of an invited address | per invitation |
| `organization.role_changed` | `updateMemberRole()` | `role:<membership>:<role>:<epoch>` |
| `organization.member_removed` | `removeMember()` | `removed:<membershipId>` |
| `operations.domain_verified` | `POST /v1/domains/:id/verify` (verified) | per verification instant |
| `operations.domain_failed` | same route (DNS error / TXT mismatch) | one per domain per day |
| `operations.api_key_created` | `POST /v1/keys` | per key |
| `operations.api_key_revoked` | `DELETE /v1/keys/:id` | per key |
| `operations.api_key_expiring` | cron `/v1/cron/company-email` | `<keyId>:<expiryDate>` |
| `operations.webhook_failing` | worker, delivery ladder exhausted | one per endpoint per day |
| `operations.broadcast_completed` | broadcast send finishes | `broadcast:<id>:sent` |
| `operations.broadcast_paused` | broadcast pauses on the plan allowance | `broadcast:<id>:paused` |
| `usage.warning_80` | ingest, inside the 80–82% band | `usage:80:<org>:<periodEnd>` |
| `usage.exhausted_100` | ingest refuses with `plan_limit_reached` | `usage:100:<org>:<periodEnd>` |

## Not wired — and why

These are deliberate gaps, not oversights. Each row names the missing thing.

### Account (feature absent)

| Id | Needs |
| --- | --- |
| `account.two_factor_enabled` / `_disabled` | 2FA enrolment, which does not exist |
| `account.recovery_codes_generated` | 2FA recovery codes |
| `account.locked_out` | login lockout (`failed_login_attempts` exists in schema `0022`, no route sets it) |
| `account.suspicious_sign_in_blocked` | a sign-in risk decision |
| `account.email_change_requested` / `_changed` | an email-change flow (address changes today happen outside the product) |
| `account.deletion_scheduled` / `account.deleted` | self-serve account deletion |
| `account.data_export_ready` / `_failed` | a data-export job |

### Billing (no payment system, by decision)

`billing.trial_started`, `billing.trial_ending`, `billing.trial_ended`,
`billing.payment_succeeded`, `billing.payment_failed`,
`billing.payment_failed_final`, `billing.invoice_ready`,
`billing.plan_upgraded`, `billing.plan_downgraded`,
`billing.subscription_canceled`, `billing.subscription_reactivated`,
`billing.refund_issued`, `billing.payment_method_expiring`.

Bachs is not integrated (`MockBillingProvider` only) and checkout is out of
scope, so there is no event to hang these on. They stay in the catalogue because
the copy, the preview and the consent rules are already correct — wiring them is
a matter of calling the id from the Bachs webhook handler once it exists.

### Operations

| Id | Needs |
| --- | --- |
| `operations.domain_dns_lost` | periodic re-verification of verified domains (today a domain is only checked when somebody clicks verify) |
| `operations.webhook_disabled` | an auto-disable policy after N consecutive failures; today endpoints stay enabled and the consumer mails `operations.webhook_failing` instead |
| `operations.bounce_rate_warning` / `_complaint_rate_warning` | hooked to `evaluateOrganizationAbusePolicy` at the point it pauses an organization |
| `operations.broadcast_completed` delivery/bounce detail | the counts are read at send time; terminal delivery lands later via SES events |

### Organization

| Id | Needs |
| --- | --- |
| `organization.ownership_transferred` | an in-product ownership transfer; owners are changed only by direct membership edits today |
| `organization.workspace_created` | a first-run hook in onboarding (signup creates the workspace before an address is verified, so the mail would race the welcome email) |

### Legal and product news (operator-driven)

`legal.policy_update`, `updates.product_update`, `updates.monthly_digest`,
`updates.announcement`.

There is no scheduler or composer that sends editorial mail to product users
today. The control-plane communications surface addresses the waitlist, not
customers. When it grows a composer, these four ids are the payload — the
preference and unsubscribe plumbing already exists.

## Verifying it by hand

1. Sign in, then open **Settings → Notifications** (`/settings/notifications`).
   Every catalogue entry is listed with its category, and each one renders its
   real HTML in a sandboxed iframe.
2. Toggle **Product news** off, then check `email_preferences.disabled_categories`
   contains `updates`.
3. Send yourself an optional email (control plane or a seeded send) and confirm
   `company_emails` shows `status = skipped`, `skip_reason = opted_out`.
4. Follow the footer unsubscribe link in a real message: the GET must render a
   confirmation page and change nothing; the POST must apply the opt-out.
5. Try the same for `account.password_reset_code`: there is no toggle, and a
   forged row in `email_preferences` is ignored.

## Test gates

- `pnpm --filter @calder/notify test` — catalogue/template/render/preference
  invariants, idempotency, opt-out skip, provider failure recorded as `failed`.
- `pnpm --filter @calder/api test` — ingest quota refusal, sender checks and the
  broadcast pipeline that company mail reuses for its own notifications.
- Integration suites (`RUN_INTEGRATION_TESTS=1`) need Postgres; nothing
  DB-backed is proven without one.
