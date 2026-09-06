# Operations

## Health checks

`/health` (liveness), `/ready` (readiness, dependency-inclusive).

## What to monitor

| Category       | Signals                             |
| -------------- | ----------------------------------- |
| API            | latency, error rate                 |
| Sending        | queued, sent, delivery rate         |
| Deliverability | bounce rate, complaint rate         |
| Queue          | depth, worker failures              |
| Provider       | latency, errors                     |
| Webhooks       | delivery failures, retry exhaustion |

## Scheduled jobs (all idempotent, safe to re-run)

usage aggregation, subscription reconciliation, failed webhook retry sweep, stale domain-verification cleanup, log retention, suppression maintenance, provider health checks, billing reconciliation, scheduled email processing, expired OTP cleanup.

## Failure handling

Explicit strategy required for: database/Redis unavailable, provider timeout/rejection, worker crash, duplicate/delayed webhook, lost network request, DNS propagation delay, payment webhook delay, queue backlog.

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
