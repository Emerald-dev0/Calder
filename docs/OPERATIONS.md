# Operations

## Health checks

`/health` (liveness), `/ready` (readiness, dependency-inclusive).

## What to monitor

| Category       | Signals                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| API            | latency, error rate                                                                                       |
| SMTP gateway   | connections, auth success/failure rate, messages accepted/rejected, SMTP codes, TLS failures, cert expiry |
| Sending        | queued, sent, delivery rate                                                                               |
| Deliverability | bounce rate, complaint rate                                                                               |
| Queue          | depth, worker failures                                                                                    |
| Provider       | latency, errors                                                                                           |
| Webhooks       | delivery failures, retry exhaustion                                                                       |

## Scheduled jobs (all idempotent, safe to re-run)

usage aggregation, subscription reconciliation, failed webhook retry sweep, stale domain-verification cleanup, log retention, suppression maintenance, provider health checks, billing reconciliation, scheduled email processing, expired OTP cleanup.

## Failure handling

Explicit strategy required for: database/Redis unavailable, provider timeout/rejection, worker crash, duplicate/delayed webhook, lost network request, DNS propagation delay, payment webhook delay, queue backlog, SMTP gateway crash (drain connections, fail over via LB), TLS certificate expiry, SMTP auth-store outage (fail closed — reject AUTH, never accept blindly).

## SMTP operations

- Health: TCP accept on 587 + successful AUTH against a canary credential + enqueue probe (synthetic submission that stops before the provider). Liveness vs readiness split same as API.
- TLS certificates: rotation runbook, 30/7/1-day expiry alerts. Never reload certs by restarting all gateways at once — rolling.
- Deployment: rolling with connection draining; overlapping gateway versions must be protocol-identical for the supported subset.
- Rollback: previous container image + migration compatibility (gateway migrations are additive-only).
- Abuse: auth-failure spikes page; credential-leak runbook per `SECURITY.md` §14.

## Transport operations

- Health: per-transport `healthCheck()` (Gmail: token-refresh probe; SES: config probe) surfaced in dashboard + alerts. A failing transport pages with its name, not a generic error.
- Quota monitoring: daily Gmail usage vs cap per project, with 80% warning. Approaching-cap projects get the graduation nudge automatically.
- Graduation ops: transport switches are audited; switching back is always allowed. No migration, no downtime — the queue doesn't care which transport drains it.

## Dead letter queue

Exhausted jobs → dead-letter state, dashboard shows reason/attempts/last error/timestamp, safe jobs replayable manually.

## Disaster recovery (target — not yet implemented)

- [ ] Backup schedule defined
- [ ] Restoration tested (not just configured)
- [ ] RPO defined
- [ ] RTO defined
- [ ] Provider-outage runbook

## Incident response (target)

- [ ] On-call rotation
- [ ] Severity levels
- [ ] Postmortem template
