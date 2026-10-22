# Emails Calder sends its own users

Last reviewed: 2026-10-22.

This is the inventory behind `packages/notify`. The catalogue in code is the
source of truth — `COMPANY_EMAILS` in `packages/notify/src/catalogue.ts` — and a
test asserts every entry renders. This document explains the rules and marks
what is actually wired to a trigger today.

## 1. Rules the system enforces

1. **Company mail never touches customer tables.** It is recorded in
   `company_emails`, not `emails`. A password reset must not consume a tenant's
   monthly allowance, appear in their message log, or count as a send.
2. **Category decides consent.** `updates` and `digest` are the only optional
   categories. Everything else is mandatory: `setCategoryDisabled` refuses to
   record an opt-out for a mandatory category, and the send path ignores one if
   it exists anyway.
3. **One row per attempt, claimed by unique key.** The row is written before the
   provider call. A crash mid-send leaves evidence, and a replayed event (a
   double-clicked invite, a retried webhook) collapses onto the first row rather
   than sending twice.
4. **Workspace mail goes to people who can act.** Billing, quota and
   infrastructure notices resolve to owners and admins, one row per person,
   keyed `<event>:<userId>`.
5. **Nothing sensitive is persisted.** `metadata` drops any field whose name
   matches code/token/secret/password/url/link. Provider errors are stored as
   `provider_error:<code>`, never as the provider's message, which can name the
   recipient or the transport.
6. **Failure never breaks the feature.** `sendCompanyEmailQuietly` swallows
   errors at call sites where the user action already succeeded. The row still
   records `failed`.

## 2. Categories

| Category     | Optional | Why                                                                       |
| ------------ | -------- | ------------------------------------------------------------------------- |
| `account`    | no       | Codes and receipts of the user's own actions; without them there is no access |
| `security`   | no       | Something about how the account is protected changed                      |
| `billing`    | no       | Money moved or is about to; contract and tax obligation                   |
| `legal`      | no       | A policy changed in a way that binds the user                             |
| `usage`      | no       | The workspace is near or at a ceiling it pays for                         |
| `operations` | no       | State of domains, keys, webhooks, deliverability                          |
| `updates`    | **yes**  | Product news and announcements                                            |
| `digest`     | **yes**  | Monthly workspace recap                                                   |

Optional mail carries `List-Unsubscribe` + `List-Unsubscribe-Post:
List-Unsubscribe=One-Click` and a signed footer link. Mandatory mail carries
neither, because there is nothing to unsubscribe from.

## 3. Inventory

Status: **wired** = a code path sends it today. **catalogue** = the template,
copy, category and audience exist and are tested, but the trigger ships with a
subsystem that is not built yet (broadcasts, dunning, 2FA, exports). Nothing is
marked wired unless there is a call site.

### Account

| Template                            | Trigger                                     | Status    |
| ----------------------------------- | ------------------------------------------- | --------- |
| `account.welcome`                   | first successful email verification         | wired     |
| `account.verification_code`         | signup and resend                           | wired     |
| `account.password_reset_code`       | forgotten password / email code             | wired     |
| `account.new_sign_in`               | password, code, magic link, OAuth login     | wired     |
| `account.password_changed`          | password change from settings               | wired     |
| `account.password_reset_completed`  | password reset with a recovery code         | wired     |
| `account.sign_in_method_added`      | OAuth provider connected                    | wired     |
| `account.sign_in_method_removed`    | OAuth provider disconnected                 | wired     |
| `account.sessions_revoked`          | sign out everywhere / reset                 | catalogue |
| `account.two_factor_enabled`        | 2FA switched on                             | catalogue |
| `account.two_factor_disabled`       | 2FA switched off                            | catalogue |
| `account.recovery_codes_generated`  | recovery codes regenerated                  | catalogue |
| `account.email_change_requested`    | change-email confirmation to the new address | catalogue |
| `account.email_changed`             | email changed, notice to the old address    | catalogue |
| `account.locked_out`                | login lockout after repeated failures       | catalogue |
| `account.suspicious_sign_in_blocked`| refused sign-in                             | catalogue |
| `account.deletion_scheduled`        | account deletion requested                  | catalogue |
| `account.deleted`                   | account deletion completed                  | catalogue |
| `account.data_export_ready`         | export job finished                         | catalogue |
| `account.data_export_failed`        | export job failed                           | catalogue |

### Organization (addressed to a person)

| Template                                | Trigger                                  | Status    |
| --------------------------------------- | ---------------------------------------- | --------- |
| `organization.invitation`               | team invite                              | wired     |
| `organization.invitation_accepted`      | invitee completes signup                 | wired     |
| `organization.invitation_reminder`      | T-3 days before expiry                   | catalogue |
| `organization.role_changed`             | member role changed                      | catalogue |
| `organization.member_removed`           | member removed                           | catalogue |
| `organization.ownership_transferred`    | ownership moved                          | catalogue |
| `organization.workspace_created`        | workspace created                        | catalogue |

### Billing (addressed to the workspace)

Trial, receipts, dunning, invoices, plan changes, cancellation, refunds and card
expiry. All `catalogue`: the payment system (Bachs) is not built, and these
templates exist so the integration has a destination rather than an ad-hoc
`brandEmail` call. **No price is hardcoded** — amounts and currency arrive as
formatted strings from the caller.

`billing.payment_failed` and `billing.payment_failed_final` are the two that
matter most at launch: the first says sending still works and the card needs
attention, the second says exactly when the plan downgrades and what stops.

### Usage (addressed to the workspace)

| Template               | Trigger                                    | Status    |
| ---------------------- | ------------------------------------------ | --------- |
| `usage.warning_80`     | 80% of the period allowance used           | catalogue |
| `usage.exhausted_100`  | allowance exhausted, sends refused         | catalogue |
| `usage.reset`          | new billing period                         | catalogue |
| `usage.resource_limit` | project/domain/sender/seat ceiling reached | catalogue |

Once-per-period semantics come free from the idempotency key: include the
period start in it (`usage:80:<orgId>:<periodStart>`).

### Operations (addressed to the workspace)

| Template                        | Trigger                             | Status    |
| ------------------------------- | ----------------------------------- | --------- |
| `operations.domain_verified`    | DNS verification succeeded          | wired     |
| `operations.domain_failed`      | DNS verification failed (max 1/day) | wired     |
| `operations.api_key_created`    | key created                         | wired     |
| `operations.api_key_revoked`    | key revoked or rotated              | wired     |
| `operations.domain_dns_lost`    | re-check found records missing      | catalogue |
| `operations.api_key_expiring`   | key expires within 7 days           | catalogue |
| `operations.webhook_failing`    | delivery exhausted retries          | catalogue |
| `operations.webhook_disabled`   | endpoint auto-disabled              | catalogue |
| `operations.broadcast_completed`| broadcast finished                  | catalogue |
| `operations.broadcast_paused`   | bounce/complaint threshold crossed  | catalogue |
| `operations.bounce_rate_warning`| 7-day bounce rate over the line     | catalogue |
| `operations.complaint_rate_warning` | 7-day complaint rate over the line | catalogue |

### Legal, updates, digest

`legal.policy_update` (mandatory), `updates.product_update`,
`updates.announcement` and `updates.monthly_digest` (optional). All `catalogue`;
sending them is an editorial act, not an automatic one.

## 4. Where things live

| Concern                  | Path                                            |
| ------------------------ | ----------------------------------------------- |
| Catalogue and consent    | `packages/notify/src/catalogue.ts`              |
| Copy for every template  | `packages/notify/src/render/templates.ts`       |
| HTML blocks and escaping | `packages/notify/src/render/blocks.ts`          |
| Renderer                 | `packages/notify/src/render/render.ts`          |
| Preferences              | `packages/notify/src/preferences.ts`            |
| Signed opt-out tokens    | `packages/notify/src/tokens.ts`                 |
| Delivery pipeline        | `packages/notify/src/send.ts`                   |
| Persistence port         | `packages/notify/src/store.ts`                  |
| Workspace fan-out        | `packages/notify/src/recipients.ts`             |
| Tables                   | `packages/db/src/schema/company-emails.ts`      |
| Migration                | `packages/db/drizzle/0029_company_email.sql`    |
| Opt-out endpoint         | `apps/dashboard/app/api/unsubscribe/company/`   |
| Preferences + preview UI | `apps/dashboard/app/(app)/settings/notifications/` |

## 5. Adding an email

1. Add the entry to `COMPANY_EMAILS` (category, audience, description, trigger,
   data). The type system then forces a template.
2. Write the copy in `TEMPLATES`. Plain text only; the renderer escapes.
3. Call `sendCompanyEmailQuietly` at the trigger with an event-shaped
   idempotency key.
4. Run `pnpm --filter @calder/notify test` — the suite renders every entry and
   fails on a missing one.
5. Add a line to this table with its status.

## 6. Verification performed

- `pnpm --filter @calder/notify test` — 19 unit tests (render every template,
  escaping, `javascript:` CTA dropped, opt-out rules, idempotent replay,
  provider failure recorded, unsubscribe headers only on optional mail).
- `pnpm --filter @calder/api test` — 127 passing.
- `pnpm --filter @calder/dashboard test` — 175 passing.
- Full workspace build, including the new `/settings/notifications` route.
- Clean-checkout build: deleting `packages/config/dist` **and**
  `packages/notify/dist` is repaired by `scripts/ensure-workspace-built.mjs`,
  which now includes `@calder/notify` in the dashboard's closure.
- Migration: `drizzle-kit generate` against the built schema reports
  **"No schema changes"**, so `0029_company_email.sql` matches the TypeScript
  schema exactly.

**Not verified in this sandbox:** the integration test
(`packages/notify/src/send.integration.test.ts`) and the migration were not run
against Postgres, because no database is available here. Both are gated /
documented for a local throwaway database:

```bash
RUN_INTEGRATION_TESTS=1 pnpm --filter @calder/notify test
```

The migration has not been applied to any environment, including production.
