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
- **Marketing:** audience/consent/broadcast/tracking code is merged, but public
  `MARKETING_SUITE` remains `dev`. No blanket production-readiness claim.
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
