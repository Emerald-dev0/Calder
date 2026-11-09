# Calder launch availability — evidence review, 2026-10-29

This replaces the stale pre-PR-77 checklist. Repository implementation, successful
tests, provider configuration and production operation are different claims.
History is summarized in [CHANGELOG.md](../CHANGELOG.md); it is not an SLA.

## Confirmed by the operator (October 28)

- Production `/health` returned API JSON with HTTP 200 after #86; the source-JSON
  cold-start failure was fixed. This is liveness, not a dependency/readiness check.
- An authenticated manual drain returned `checked: 2, sent: 2, failed: 0` and the
  operator confirmed both emails reached the recipient inbox.
- This confirms those two deliveries, not all users, domains, retries or scale.
- `intake.calder.click` DKIM was PENDING at the last supplied SES query, despite
  matching DNS records. No later SES SUCCESS evidence has been supplied here.

## Implemented, with deployment prerequisites

| Capability                                                                     | Evidence / qualification                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REST sending, test/live keys, idempotency, quota admission, queue/drain/worker | API routes, email service and queue code; automated tests. Test sends do not deliver real mail. Live delivery needs configured provider/Redis/database and eligible sender. |
| Domain and sender setup                                                        | Ownership checks, SES identity status and sender service exist. Ownership verification alone is not SES DKIM success.                                                       |
| Message history/resend, templates, suppressions, usage                         | Dashboard/API implementations. Resend is a new message; accepted/queued/provider-accepted/delivered are distinct.                                                           |
| Webhook and SES feedback handling                                              | Code exists; production SNS topics, signatures, subscriptions and actual event delivery must be verified separately.                                                        |
| Operational endpoints                                                          | `/health` is liveness; `/ready` checks dependencies; cron routes require authentication. A browser visiting a cron route normally gets 401.                                 |

## Not launch-certified

- **Automatic prompt sending:** PR #87 fixes missing dashboard wake-ups and the API
  background lifecycle. It is under review, not a confirmed production rollout.
  API and dashboard both need matching `CRON_SECRET`, explicit `API_URL`, redeploys
  and a new send without manual drain. Daily cron is a backstop, not a latency SLA.
- **Billing:** owner confirms payments are not set up. Billing adapters/schema and
  planned prices do not constitute checkout, subscriptions or invoices. Usage hides
  purchase offers but keeps current sending/resource caps. No promise of unlimited
  access or automatic entitlement to every paid tier is made.
- **SDKs:** Node/Python/Ruby/PHP source exists. Node/Python have repository tests;
  publication, package ownership/provenance and install-to-live smoke tests have not
  been verified. Public launch guidance uses direct HTTP; SDK install tabs are hidden.
- **SMTP:** specification/docs exist; no `apps/smtp-gateway` implementation in this
  checkout. Do not claim a public SMTP host is operational.
- **Gmail:** adapter/OAuth code exists; production OAuth configuration/approval and
  a real send have not been verified in this review.
- **Marketing:** audience/consent/broadcast/tracking code is merged but the suite
  is excluded from the MVP. The API returns `403 feature_not_available`, the
  dashboard shows Coming Soon, and public surfaces no longer mark it as included.
- **Recovery/SLA:** no new restore drill, scale test, uptime or backup guarantee is
  established by this review. Older roadmap audit entries are historical snapshots.

## Before inviting users

1. Resolve CI gates and human review; deploy API and dashboard with matching
   server-only cron secrets and correct API_URL. Never publish or log the secret.
2. Send one new dashboard email and one API email without manually draining;
   inspect queued → sent and inbox/event outcomes. Exercise rejection and retry.
3. Verify `/ready`, SES identity status and feedback/webhook configuration.
4. Confirm limits for newly created organizations and show them honestly.
5. Keep billing, unpublished SDK packages, SMTP and unverified Gmail setup out of
   ready-to-use promises. Revisit this file only when evidence changes.

## Feature availability reconciliation — 2026-11-08

Repository state, availability and commercial status are now reconciled in
[MVP-FEATURE-MATRIX.md](MVP-FEATURE-MATRIX.md). Summary:

- **Live MVP:** transactional email, API, queue/worker/provider pipeline,
  templates (create/list/edit/delete/search/paginate/preview/send-by-alias),
  senders, domains and verification, delivery logs/tracking, suppression,
  bounce/complaint/unsubscribe, idempotency, limits, test environment, batch and
  scheduled sends, keys, webhooks (signing, logs, replay), usage and basic
  analytics, audit logs, team and workspace settings.
- **Coming Soon (disabled):** broadcasts, audiences, campaigns, inbound email,
  SMTP gateway, advanced analytics, queue visibility, rate-limit controls,
  per-plan roles, dedicated IPs/warmup/SLA/SSO, Gmail transport, third-party
  integrations, aggregate bounce/complaint analytics, customer uptime history.
- **Enforcement:** a single registry (`packages/config/src/features.ts`) drives
  the API gate, dashboard availability and public copy. Marketing endpoints fail
  at the boundary; dashboard server actions refuse before touching data.
- **Plans:** three plans are sold (Beginner, Starter, Pro). Premium and Scale
  are retired: their config entries and database values remain so historical
  subscriptions keep resolving to real limits, but they are hidden from pricing
  and rejected by every assignment path. Billing still cannot assign a paid
  tier automatically. Resource and email ceilings remain enforced; retention,
  per-plan environments and tier-restricted tools are not claimed because they
  are not enforced (`UNENFORCED_PLAN_DIFFERENCES`).
- **Security repair:** appended obfuscated payloads were present in eleven
  build/migration/config files in this checkout. They were removed without
  rewriting history; the source-integrity gate now reports clean. See
  SECURITY.md §16.

Still outstanding before inviting users: a hosted send without a manual drain,
SES/SNS production verification, billing, and the owner decisions in
MVP-FEATURE-MATRIX §7.
