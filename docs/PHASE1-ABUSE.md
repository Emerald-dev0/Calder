# Phase 1 — abuse prevention and send safety

## Scope

Phase 1 is limited to email-sending safety. It does not add SMTP, other
channels, paid billing, referral systems, or AI risk scoring. Test-environment
mail remains mock-only and never enters live usage metering.

## Signup guard

New accounts are rejected on the server when their email domain matches the
built-in temporary-mail domain set or a deployment-added domain. The check is
applied in password signup, new OAuth account creation, and magic-link account
creation at token consumption. Existing account sign-in/linking is not blocked,
and requesting a magic link is not treated as account creation. No domain or
classifier detail is included in the user-facing error. The built-in list is a
curated baseline, not a claim of exhaustive coverage; operators can add domains
with `DISPOSABLE_EMAIL_DOMAINS`.

## Organization-wide new-account allowance

During the configured age of an organization, all its projects and API keys
share one accepted-live-send allowance. The default is 50 live messages during
the first 24 hours after organization creation. The ceiling counts persisted
live email rows (queued acceptance counts; test rows do not), and is enforced
inside the same organization-row-locked transaction as idempotency claim, email
persistence, and the initial queued event. This serializes concurrent requests
across projects/keys and prevents a race past the cap. Existing subscription
quotas are checked through this same shared decision. Calder's internal org is
exempt from both usage ceilings; it is not exempt from suspension or a feedback
pause.

## Recent feedback pause

Verified, matched SES SNS feedback is applied in one transaction with provider
event deduplication, email status/event changes, suppressions, automatic org
pause, and audit log. Feedback evaluations serialize on the organization row,
so concurrent SNS deliveries cannot each observe a below-threshold partial
count and miss a crossing. The automatic signal uses recent live provider-accepted
messages, a minimum denominator, unique email counts, permanent bounces (soft
bounces do not count), and complaints. Defaults are a 7-day window, at least
20 sends, a 10% permanent-bounce rate, or a 2% complaint rate. The first
threshold reached moves only `active` to `abuse_paused`; an operator-set
`suspended` status is never overwritten. A zero rate threshold disables that
signal. Metrics and thresholds are stored only in internal audit metadata.

## Shared sending gate

The database package owns the common organization status and admission logic.
API email sends, the API sender test-send, dashboard composer/sender-test,
onboarding's direct fallback, and the Control Plane's internal test send all
check eligibility at acceptance. API and dashboard key-creation paths check
status under the organization lock. Both the serverless drain and worker read
current organization status immediately before every provider leg. A blocked
queued/retried message is marked failed with a generic reason, produces a
failed lifecycle event, and is never provider-metered as delivered. Provider
acceptance remains the only metering point, with the existing deterministic
`ur_<emailId>` ledger id unchanged.

## Founder/admin kill switch

Organization status is stored on the existing organization row:

- `active`: sending enabled.
- `abuse_paused`: automatically set by recent verified feedback; sending is
  blocked until an authorized operator reviews and resumes.
- `suspended`: manually set by founder/security/platform admin or the
  authenticated admin API. Every unrevoked API key across every project is
  revoked in the same transaction as the status update and audit row.

Manual resume returns to `active` but never revives old keys. Customers must
create fresh keys. The Control Plane organization detail contains the minimal
status/reason/action surface; `POST /v1/admin/organizations/:orgId/sending-status`
is the authenticated emergency API path and requires an `Idempotency-Key`.
There is no authorization cache to
invalidate: database key lookup observes `revoked_at` on the next request.

## Operator response

Use the sending-safety panel or admin endpoint to suspend immediately when
needed; include a reason. Review the organization's audit entries, matched SES
feedback, provider-accepted denominator, and suppressed recipients; verify the
sender identity, list permission, and acquisition source before resuming. For a
manual suspension, resume does not restore credentials: issue new keys after
review. For an automatic pause, no keys are revoked, but the organization
remains blocked until an explicit resume. Escalation/appeal is manual: email
`support@calder.click` with subject `sending safety review`; there is no
automated appeal workflow in Phase 1.

## Migration and configuration

Apply the additive, forward-only `0024_organization_sending_safety` migration
before deploying code. Defaults and environment settings are listed in
`.env.example` and `docs/DEPLOYMENT.md`. Keep `ORG_NEW_SEND_*` values identical
on API and dashboard deployments. SES auto-pause requires verified SNS event
wiring (`SES_SNS_TOPIC_ARNS` and a working SES configuration set); without
feedback wiring, automatic reputation response cannot run.
