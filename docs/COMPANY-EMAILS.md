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

| Rule                                                                           | Where                                   |
| ------------------------------------------------------------------------------ | --------------------------------------- |
| An unknown template id throws before anything is written                       | `send.ts` → `companyEmailDefinition`    |
| `updates` and `digest` are the only opt-out categories                         | `catalogue.ts` → `OPTIONAL_CATEGORIES`  |
| A mandatory category can never be opted out, even by a hand-written row        | `preferences.ts` → `isCategoryDisabled` |
| Optional mail carries `List-Unsubscribe` + RFC 8058 one-click                  | `send.ts`                               |
| The unsubscribe link is signed per (user, category) and cannot enable anything | `tokens.ts`                             |
| A GET on the unsubscribe link never changes state                              | `app/api/unsubscribe/company/route.ts`  |
| One row per attempt, written before the provider call                          | `company_emails`                        |
| A repeated event collapses onto the first row (unique `idempotency_key`)       | `company_emails_idempotency_unique`     |
| Provider errors are stored as a class, never the response body                 | `send.ts` → `scrubError`                |
| Codes, tokens and links never reach `metadata`                                 | `send.ts` → `safeMetadata`              |
| Delivery failure never fails the operation that caused it                      | `sendCompanyEmailQuietly`               |
| Workspace mail goes to owners and admins, not every member                     | `recipients.ts`                         |

## Wired (36)

| Id                                   | Fires from                                        | Key                                        |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------ |
| `account.verification_code`          | signup / resend (`api/auth/email-code`)           | `otp:verification:<email>:<code>`          |
| `account.password_reset_code`        | reset request (`lib/send-auth-email.ts`)          | `otp:reset:<email>:<code>`                 |
| `account.welcome`                    | first verification (`api/auth/email-code/verify`) | per user                                   |
| `account.locked_out`                 | login lockout (`LoginLockedError`)                | `lock:<userId>:<lockedUntil>`              |
| `account.email_change_requested`     | `requestEmailChange()`                            | `email-change:<user>:<address>:<expiry>`   |
| `account.email_changed`              | `/api/auth/email-change/confirm`                  | `email-changed:<new/old>:<user>:<address>` |
| `account.data_export_ready`          | `requestDataExport()` → signed one-hour link      | `export:<user>:<minute>`                   |
| `account.data_export_failed`         | the export route's failure path                   | per attempt                                |
| `account.new_sign_in`                | login, magic link, OAuth callback                 | per sign-in                                |
| `account.password_changed`           | `api/auth/password-change`                        | per change                                 |
| `account.password_reset_completed`   | `api/auth/password-reset`                         | per reset                                  |
| `account.sign_in_method_added`       | OAuth callback                                    | per provider link                          |
| `account.sign_in_method_removed`     | `api/auth/oauth/disconnect`                       | per provider unlink                        |
| `account.sessions_revoked`           | `signOutOtherSessions()`                          | per event                                  |
| `organization.invitation`            | `inviteMember()`                                  | `invite:<invitationId>`                    |
| `organization.invitation_reminder`   | cron `/v1/cron/company-email`                     | `<invitationId>:<expiresAt>`               |
| `organization.invitation_accepted`   | verification of an invited address                | per invitation                             |
| `organization.role_changed`          | `updateMemberRole()`                              | `role:<membership>:<role>:<epoch>`         |
| `organization.member_removed`        | `removeMember()`                                  | `removed:<membershipId>`                   |
| `organization.ownership_transferred` | `transferOwnership()` (both sides)                | `ownership:<org>:<to/from>:<user>:<epoch>` |
| `organization.workspace_created`     | `completeOnboarding()`                            | `workspace-created:<orgId>:<userId>`       |
| `operations.domain_verified`         | `POST /v1/domains/:id/verify` (verified)          | per verification instant                   |
| `operations.domain_failed`           | same route (DNS error / TXT mismatch)             | one per domain per day                     |
| `operations.api_key_created`         | `POST /v1/keys`                                   | per key                                    |
| `operations.api_key_revoked`         | `DELETE /v1/keys/:id`                             | per key                                    |
| `operations.api_key_expiring`        | cron `/v1/cron/company-email`                     | `<keyId>:<expiryDate>`                     |
| `operations.webhook_failing`         | worker, delivery ladder exhausted                 | one per endpoint per day                   |
| `operations.webhook_disabled`        | worker, 5 consecutive exhausted deliveries        | one per endpoint per day                   |
| `operations.bounce_rate_warning`     | SES feedback pause (`autoPaused`)                 | `abuse:permanent_bounce_rate:<org>:<day>`  |
| `operations.complaint_rate_warning`  | SES feedback pause (`autoPaused`)                 | `abuse:complaint_rate:<org>:<day>`         |
| `operations.broadcast_completed`     | broadcast send finishes                           | `broadcast:<id>:sent`                      |
| `operations.broadcast_paused`        | broadcast pauses on the plan allowance            | `broadcast:<id>:paused`                    |
| `usage.warning_80`                   | ingest, inside the 80–82% band                    | `usage:80:<org>:<periodEnd>`               |
| `usage.exhausted_100`                | ingest refuses with `plan_limit_reached`          | `usage:100:<org>:<periodEnd>`              |
| `updates.announcement`               | control plane → Company email → Send batch        | `operator:<contentHash>:<userId>`          |
| `updates.product_update`             | same console                                      | `operator:<contentHash>:<userId>`          |

## Not wired — and why

These are deliberate gaps, not oversights. Each row names the missing thing.

### Account (feature absent)

| Id                                               | Needs                               |
| ------------------------------------------------ | ----------------------------------- |
| `account.two_factor_enabled` / `_disabled`       | 2FA enrolment, which does not exist |
| `account.recovery_codes_generated`               | 2FA recovery codes                  |
| `account.suspicious_sign_in_blocked`             | a sign-in risk decision             |
| `account.deletion_scheduled` / `account.deleted` | self-serve account deletion         |

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

| Id                                                      | Needs                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `operations.domain_dns_lost`                            | periodic re-verification of verified domains (today a domain is only checked when somebody clicks verify) |
| `operations.broadcast_completed` delivery/bounce detail | the counts are read at send time; terminal delivery lands later via SES events                            |

### Organization

| Id  | Needs |
| --- | ----- |

### Legal and product news (operator-driven)

`legal.policy_update`, `updates.monthly_digest`.

`updates.announcement` and `updates.product_update` are now sent from
**Control → Communications → Company email**, which previews the real template,
requires a confirmation, honours opt-outs per recipient and audit-logs the batch.

The composer treats the preview as a gate rather than a decoration: the compose
form is a GET step that renders **your** draft through the real template (same
footer, same opt-out link, subject included), and the send form carries that
exact draft in hidden fields. What was read is what is sent.

Every detail below is enforced server-side, not suggested by the form:

- **`{{name}}`** is the only merge field. It resolves per recipient to the
  account's first name, or `there` when there is none, and is substituted once
  per recipient before the renderer's escaping — so nobody can be mailed
  somebody else's name, and a name containing markup is escaped like any other
  value. Any other field (`{{first_name}}`, `{{company}}`) is **refused** at
  preview and again at send, because the alternative is shipping a literal
  placeholder to hundreds of inboxes.
- **Audience** is a per-send choice, and there are three. Verified accounts
  (the default), every account including unverified addresses, or **specific
  people** named by address. The wide option requires its own acknowledgement —
  an unverified address may not exist, and a bounce is charged to Calder's
  sending reputation — and the server enforces that independently of the form,
  computed from the addresses actually in the run rather than from the menu item
  that produced them. Unknown or absent values parse to the narrow audience, so a
  malformed request cannot widen a mailshot.
- **A named list means accounts.** An address that belongs to no user is refused
  and named, never silently dropped, so the composer cannot be used to mail
  strangers and an operator cannot believe they reached someone they did not.
  The resolution runs on the page (so the preview says "4 of 6 matched, 2 not
  accounts") and again in the action (which is the gate).
- **From** is a closed list. `COMPANY_EMAIL_SENDERS` declares the extra
  addresses this deployment may send as, and `AUTH_EMAIL_FROM` — the sender
  every transactional email already uses — is always on it, default first. The
  page resolves the choice through the same function the action enforces, and
  an address off the list is a refusal rather than a fallback: sending from a
  different address than the one previewed is exactly the lie this console
  exists to avoid. Nothing here invents an address; an entry must be a real,
  SES-verified identity.
- **A run is bounded, a batch is not.** One press sends to at most
  `COMPANY_BROADCAST_RUN_SIZE` recipients (150 by default, 1–500): a provider
  call is a network round trip, and one request has to finish. Recipients the
  batch has already reached — read from the per-recipient idempotency keys, not
  from a counter — are excluded from the next run, so a list of any size is
  finished by pressing again, with the same draft kept in the form. The page
  states who this press reaches, how many never confirmed their address, and how
  many follow.
- **A replay is not a send.** Re-clicking the same content on the same UTC day
  collapses onto the same rows, and those rows are reported as _already had it_,
  not counted as sent. (The previous shape counted a replay as `sent`, which let
  a no-op report a full batch.)
- **Optional categories ride the marketing stream.** `updates.*` goes out on the
  SES marketing configuration set (`SES_CONFIGURATION_SET_BROADCAST`), so a
  mailshot's bounces land on marketing reputation rather than on the stream that
  carries verification codes and password resets. Account mail stays
  transactional.

A note to yourself from **Send test to me** is marked `operatorTest` in its
`company_emails` row, and every "sent" number and "last sent" date on the page
excludes those rows: a test is not a send to customers.

### Who each class of mail comes from

| Mail                                                  | From                                                              | Why                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Verification codes, password resets, security notices | `AUTH_EMAIL_FROM` (`Calder <hello@calder.click>`)                 | Nobody can unsubscribe from these, so they keep a stable, automated-looking sender and stay on the transactional stream.             |
| `account.welcome`                                     | `COMPANY_WELCOME_FROM`, else the default sender                   | This is the one email whose copy says _"reply to this email — it reaches a person"_. Point it at a mailbox someone actually reads.   |
| Operator broadcasts (`updates.*`)                     | whichever address the operator picks from `COMPANY_EMAIL_SENDERS` | Replies should reach whoever can answer the question the broadcast asks — support, usually — without changing where codes come from. |

Every one of those addresses must be verifiable at SES on Calder's own domain
(any local part of a verified domain is fine). `COMPANY_WELCOME_FROM` must also
appear in `COMPANY_EMAIL_SENDERS` (or be `AUTH_EMAIL_FROM`); a value that does not
is ignored with a logged warning and the default sender is used, because a typo
should not stop a new user from being welcomed.

The catalogue table reports **accepted** sends only: "last sent" is derived from
`company_emails` rows with `status = 'sent'`, with refused and skipped attempts
counted separately, and the footer separates the three states that exist
(accepted at least once, only ever refused or skipped, never attempted). A
catalogue entry is a declaration of intent, not proof of delivery.

`legal.policy_update` needs a published-policy source to quote; `monthly_digest`
needs a scheduling job that aggregates a period per workspace. Both have copy
and consent plumbing ready.

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
6. Settings → **Your data** → "Email me a download link". Open it signed in: the
   archive streams as JSON. Open it in a private window: 401, because the
   session must match the token.

## Test gates

- `pnpm --filter @calder/notify test` — catalogue/template/render/preference
  invariants, idempotency, opt-out skip, provider failure recorded as `failed`.
- `pnpm --filter @calder/api test` — ingest quota refusal, sender checks and the
  broadcast pipeline that company mail reuses for its own notifications.
- Integration suites (`RUN_INTEGRATION_TESTS=1`) need Postgres; nothing
  DB-backed is proven without one.
