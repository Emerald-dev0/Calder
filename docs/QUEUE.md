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
- Job types executed: `email.send` (drains a bounded email batch),
  `webhook.deliver` (one attempt, see §7a), and `billing.maintenance` (expires
  unused credits).
- Each invocation first reaps expired **job** leases, recovers expired **webhook
  delivery** leases, and repairs missing wake-ups: queued emails with no live
  job, and pending deliveries with no live job. This is what makes due work
  discoverable with no customer traffic.
- Runtime budget is 45s (the platform hard stop is 60s). Claims are taken in
  chunks of 5; if the budget is reached between jobs, unstarted claims are
  released without consuming an attempt.
- Records one `queue_processor_runs` row per invocation (trigger, counts,
  duration, error).
- Safe to call concurrently and from multiple schedulers.

## 7a. Webhook delivery on the queue

A **delivery** (`webhook_deliveries`) is the durable event for one endpoint; its
id is the `webhook-id` and never changes across retries. An **attempt**
(`webhook_delivery_attempts`) is one HTTP request. Retries add attempts; they do
not create new events. Exactly-once is not claimed.

- Enqueue: `enqueueWebhookDeliveries` writes the delivery row then a
  `webhook.deliver` job whose payload is `{deliveryId, projectId}`.
- Claim: `pending` → `sending` with a 120s lease. A crash leaves `sending`
  behind; `recoverExpiredWebhookDeliveries` returns it to `pending`.
- Response policy: 2xx delivered; 400/401/403/404/405/410/413/414/415/422
  permanent (`failed`, no retry); everything else retryable.
- Budget: 8 attempts, delays `5s, 30s, 120s, 600s, 1800s, 7200s, 21600s`.
  Attempt 8 without success → `exhausted` and the job completes.
- Disabled/deleted endpoint or undecryptable secret → permanent, explicit error;
  no requests are made.
- The body is the stored envelope, so retries send identical bytes. Headers:
  `webhook-id`, `webhook-signature: t=<unix>,v1=<hmac-sha256(t.body)>`.
- Operator actions: `GET /v1/jobs/dead-letter`,
  `POST /v1/jobs/dead-letter/jobs/:id/reprocess`,
  `POST /v1/jobs/dead-letter/webhooks/:id/reprocess`. Delivered events are
  refused (409); replaying an accepted event is a business decision, not a retry.
- Secrets are decrypted only at send time and never written to attempt rows or
  logs. Endpoint URLs are redacted to origin+path in logs.

## 8. Scheduling: honest limits

There is **no reliable free per-minute scheduler** in the current hosting plan.

| Option                       | Real limit                                                                                  | Verdict                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Vercel Cron (Hobby)          | Cron jobs run at most **once per day**; 2 jobs                                              | Cannot meet send latency                 |
| Vercel Cron (Pro, $20/mo)    | Minute-level schedules; 40 jobs                                                             | Not $0                                   |
| GitHub Actions `schedule`    | Minimum 5 minutes; frequently delayed 10–30+ min, disabled after 60 days of repo inactivity | Best-effort only, not a guarantee        |
| cron-job.org (free)          | 1-minute HTTP scheduler; no SLA, 4–40s jitter, 30s timeout, email alerts, no retries        | **Best $0 scheduler; still best-effort** |
| Other free external cron     | 1–5 minute HTTP scheduling, vendor-dependent limits                                         | Best-effort only                         |
| External free uptime monitor | Some allow 5-minute HTTP pings                                                              | Not a scheduler                          |
| Request-triggered drain      | Fires on send, but no traffic means no drain                                                | Works for active traffic only            |

Therefore: delivery latency is **not guaranteed** on $0 infrastructure. The
request-triggered drain (`kickDrain`) handles active traffic immediately; the
scheduled processor is a safety net, not a latency SLA. If a minute-level
guarantee is required, either pay for a scheduler/worker or accept the honest
limitation. We do not claim a "$0 always-on worker".

**Operating decision (owner, Round 5): cron-job.org every minute + GitHub
Actions every five minutes.** Both are free and externally hosted; the daily
Vercel drain remains a backstop. This is the accepted setup for now. It is
still outcome **B** — best-effort, no guarantee — because neither external
service has an SLA that covers Calder. Implemented:

- **Recommended primary clock: cron-job.org**, every minute, `POST
https://api.calder.click/v1/jobs/process` with
  `Authorization: Bearer $QUEUE_PROCESSOR_SECRET` and
  `x-calder-trigger: scheduler`. Scheduler-triggered calls use a 15s runtime
  budget so the free tier's 30s timeout cannot fire mid-run; the response is
  small JSON. Enable failure notifications. It is a real cron scheduler (not an
  uptime pinger), but it is a community service with **no SLA**, 4–40s jitter,
  no retries, one region (Germany), and 2-day history. It also stores the
  processor secret in its job configuration — use the dedicated, rotatable
  `QUEUE_PROCESSOR_SECRET` and nothing broader.
- `.github/workflows/queue-processor.yml` calls the authenticated
  `POST /v1/jobs/process` every 5 minutes (`x-calder-trigger: scheduler`),
  with concurrency 1 and a hard failure when the call is non-2xx or the secret
  is missing. GitHub explicitly does not guarantee schedule timing and disables
  schedules after 60 days of repository inactivity.
- Vercel Hobby cron calls the existing daily `/v1/cron/drain` at 00:00 UTC,
  which now also runs a short (20s) processor pass as a second backstop.
  Vercel Hobby allows only two cron jobs, so no third schedule was added.
- `GET /v1/jobs/status` exposes pending/due/retrying/expired-lease/dead-letter
  counts, oldest pending/due age, webhook backlog, and the last successful and
  failed processor run. A stale `lastSuccess` is the signal that the scheduler
  itself stopped.

Observed delay with cron-job.org is **typically 5–60 seconds**, plus processing
time; it is still unbounded if the third-party service is down, delays, or
suspends the job, and there is no retry. GitHub Actions and the daily Vercel
cron remain secondary backstops. A guarantee requires one of:

1. Vercel Pro ($20/mo) minute-level cron plus monitoring, or
2. a small always-on worker (paid host) consuming the same table, or
3. an external scheduler with its own alerting contract (not a free uptime ping).

Failure to run is visible at `/v1/jobs/status` (`processor.lastSuccess`,
`jobs.oldestDueAgeSeconds`) and `/v1/cron/alerts` (queued email age).

## 9. Migration from BullMQ/Redis

Current state: **dual-write for email; webhooks are Postgres-only**, not removal.

1. Email send paths commit the email row, then enqueue the Postgres job
   (`available_at = scheduled_at` for scheduled sends), then enqueue the legacy
   BullMQ job as the immediate wake-up.
   Webhook deliveries are enqueued only on the Postgres queue. The legacy
   `apps/worker` consumer is not deployed; any Redis jobs still queued from
   before this change may deliver once in parallel with the new processor, so
   receivers must dedupe on `webhook-id` during the transition.
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
| `QUEUE_SCHEDULER_MODE`   | no                       | Label shown in `/v1/jobs/status`        |

## 11. Troubleshooting

| Symptom                                 | Check                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `503 processor_disabled`                | `QUEUE_PROCESSOR_SECRET` is unset in the deployment                                                                         |
| `401` from processor                    | Bearer token does not match exactly; no fallback secret is accepted                                                         |
| Jobs stay `pending`                     | Scheduler is not running, or `available_at` is in the future                                                                |
| Jobs stay `processing`                  | Processor crashed; wait for the lease to expire or run the endpoint again                                                   |
| `oldestPendingAgeSeconds` keeps growing | Alert: scheduled fallback is failing (`/v1/cron/alerts`)                                                                    |
| Email queued but not sent               | Check the `emails` row lease, `last_error`, and suppression state; the job is only a wake-up                                |
| Dead-lettered job                       | Inspect `last_error`; `GET /v1/jobs/dead-letter`, then `POST …/jobs/:id/reprocess`                                          |
| Webhook stuck `sending`                 | Check `lock_expires_at`; recovery returns it to `pending` after the lease                                                   |
| Duplicate deliveries                    | Not an exactly-once system. Verify provider ids and email attempt counts; do not assume the queue deduped a provider accept |
