# Durable PostgreSQL queue (Approach A)

Status: **implemented and tested locally against PostgreSQL 17; not deployed to
production.** The legacy BullMQ/Redis path remains in place while the new queue
proves itself; see §8.

## 1. Why

There is no always-on worker in the deployment. SES delivery currently depends on
a request-triggered drain plus a daily Vercel cron, which cannot meet per-minute
latency on its own. Round 4 replaces the _queue_ with a durable table that a
short-lived, authenticated invocation can drain, without paying for a worker.

## 2. Schema (`jobs`)

| Column                                     | Type / default                                    | Purpose                 |
| ------------------------------------------ | ------------------------------------------------- | ----------------------- |
| `id`                                       | `job_<24hex>`                                     | Primary key             |
| `job_type`                                 | varchar(64)                                       | e.g. `email.send`       |
| `account_id`                               | text → organizations, nullable                    | Tenant scope            |
| `payload`                                  | jsonb                                             | Job input               |
| `status`                                   | `pending/processing/completed/failed/dead_letter` | Lifecycle               |
| `priority`                                 | integer, default 0                                | Higher first            |
| `attempts`                                 | integer, default 0                                | Incremented at claim    |
| `max_attempts`                             | integer, default 5                                | Retry ceiling           |
| `available_at`                             | timestamptz, default now                          | Scheduled/backoff gate  |
| `locked_at`                                | timestamptz                                       | Lease start             |
| `locked_until`                             | timestamptz                                       | Lease expiry            |
| `locked_by`                                | text                                              | Processor id            |
| `last_error`                               | text                                              | Last failure, truncated |
| `idempotency_key`                          | varchar(255), unique per `(job_type, key)`        | Duplicate suppression   |
| `created_at`, `updated_at`, `completed_at` | timestamptz                                       | Audit                   |

Index: `(status, available_at, priority)` for the claim path.

## 3. Claiming

One statement:

```sql
with picked as (
  select id from jobs
   where status = 'pending'
     and available_at <= now()
     and (locked_until is null or locked_until < now())
   order by priority desc, available_at asc, created_at asc
   limit $n
   for update skip locked
)
update jobs j
   set status = 'processing',
       locked_at = now(),
       locked_until = now() + ($lease * interval '1 second'),
       locked_by = $worker,
       attempts = j.attempts + 1
  from picked
 where j.id = picked.id
 returning j.*;
```

`SKIP LOCKED` lets concurrent processors take disjoint batches without
serialising. The attempt counter increments **at claim**, so a processor that
crashes repeatedly cannot loop forever.

## 4. Leases and crash recovery

`reapExpiredLeases()` returns `processing` rows whose `locked_until` has passed
to `pending`, clearing the lock. It runs at the start of every processor
invocation and from the scheduled fallback. Attempts are not refunded, so a
poison job eventually dead-letters.

## 5. Retry, backoff, dead letters

- Retryable failure: back to `pending`, `available_at = now + max(1s, retryDelayMs)`.
  The caller supplies the delay (exponential + jitter belongs to the retry policy,
  not the table).
- Exhausted attempts or a permanent failure: `dead_letter` / `failed`.
- `requeueDeadLetter(id)` is the operator action: resets attempts and locks.
- Dead-lettered rows remain inspectable through `jobMetrics()` and SQL; no
  payload is destroyed.

## 6. Idempotency and delivery guarantees

- Enqueue is idempotent on `(job_type, idempotency_key)`.
- Email rows themselves are the durable record; the job is a wake-up. The email
  drain claims rows with its own lease, so overlapping processors cannot both
  deliver the same row.
- **Not exactly-once.** A crash between SES accepting a message and recording the
  provider id is ambiguous. The code records attempts and provider ids so the
  ambiguity is visible, and never claims exactly-once delivery.

## 7. Processor

`POST /v1/jobs/process` with `Authorization: Bearer $QUEUE_PROCESSOR_SECRET`.

- Dedicated secret. Not `CRON_SECRET`, not `ADMIN_API_KEY`, no fallback.
- Unset secret → `503 processor_disabled` (the endpoint is inert).
- One invocation: reap leases, claim at most 25 jobs, execute, return JSON.
- Bounded batch; no daemon, no timers, no in-process loop.
- Job types currently executed: `email.send` (drains a bounded email batch),
  `webhook.deliver`, `billing.maintenance` (claimed; handlers for the last two
  are follow-up work).
- Safe to call concurrently and from multiple schedulers.

## 8. Scheduling: honest limits

There is **no reliable free per-minute scheduler** in the current hosting plan.

| Option                       | Real limit                                                                                  | Verdict                           |
| ---------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| Vercel Cron (Hobby)          | Cron jobs run at most **once per day**; 2 jobs                                              | Cannot meet send latency          |
| Vercel Cron (Pro, $20/mo)    | Minute-level schedules; 40 jobs                                                             | Not $0                            |
| GitHub Actions `schedule`    | Minimum 5 minutes; frequently delayed 10–30+ min, disabled after 60 days of repo inactivity | Best-effort only, not a guarantee |
| External free uptime monitor | Some allow 5-minute HTTP pings                                                              | Vendor-dependent, not a scheduler |
| Request-triggered drain      | Fires on send, but no traffic means no drain                                                | Works for active traffic only     |

Therefore: delivery latency is **not guaranteed** on $0 infrastructure. The
request-triggered drain (`kickDrain`) handles active traffic immediately; the
scheduled processor is a safety net, not a latency SLA. If a minute-level
guarantee is required, either pay for a scheduler/worker or accept the honest
limitation. We do not claim a "$0 always-on worker".

Recommended $0 setup: keep the daily Vercel cron plus a GitHub Actions workflow
(if the repository is public) or a 5-minute uptime ping to
`/v1/jobs/process`. Document the observed delay. Failure to run must be visible:
`/v1/cron/alerts` reports queue age, and `jobMetrics().oldestPendingAgeSeconds`
is exposed there.

## 9. Migration from BullMQ/Redis

Current state: **dual-write**, not removal.

1. Send paths commit the email row, then enqueue the Postgres job, then enqueue
   the legacy BullMQ job as the immediate wake-up.
2. The Postgres processor drains the same `emails` rows; the BullMQ worker and
   API drain remain active.
3. Removal gates (all required):
   - processed job latency and dead-letter counts observed in production;
   - no Redis producer remains;
   - pending/delayed BullMQ jobs drained or migrated;
   - worker deploy removed;
   - `bullmq`/`ioredis` dependencies removed only after the above.
4. Nothing is deleted from `emails`, `usage_records` or `jobs` during migration.

Until those gates pass, Redis stays a supported dependency.

## 10. Environment variables

| Variable                 | Required                 | Meaning                                 |
| ------------------------ | ------------------------ | --------------------------------------- |
| `DATABASE_URL`           | yes                      | Postgres used for jobs and email ledger |
| `QUEUE_PROCESSOR_SECRET` | yes for processor        | Dedicated processor bearer token        |
| `CRON_SECRET`            | yes                      | Legacy drain/alerts cron auth           |
| `REDIS_URL`              | until migration complete | Legacy BullMQ only                      |

## 11. Troubleshooting

| Symptom                                 | Check                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `503 processor_disabled`                | `QUEUE_PROCESSOR_SECRET` is unset in the deployment                                                                         |
| `401` from processor                    | Bearer token does not match exactly; no fallback secret is accepted                                                         |
| Jobs stay `pending`                     | Scheduler is not running, or `available_at` is in the future                                                                |
| Jobs stay `processing`                  | Processor crashed; wait for the lease to expire or run the endpoint again                                                   |
| `oldestPendingAgeSeconds` keeps growing | Alert: scheduled fallback is failing (`/v1/cron/alerts`)                                                                    |
| Email queued but not sent               | Check the `emails` row lease, `last_error`, and suppression state; the job is only a wake-up                                |
| Dead-lettered job                       | Inspect `last_error`; `requeueDeadLetter(id)` retries once                                                                  |
| Duplicate deliveries                    | Not an exactly-once system. Verify provider ids and email attempt counts; do not assume the queue deduped a provider accept |
