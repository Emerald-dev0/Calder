# Round 5 handoff — delivery reliability

Status: **implementation complete; deployment verification pending.** Nothing
here claims production verification. Payments were out of scope; no payment
code was changed, and no pre-existing payment dependency blocked this round.

Evidence labels used below:

| Label               | Meaning                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| Implemented         | Code and migration exist and build                                       |
| Unit tested         | Pure logic covered without a database                                    |
| Integration tested  | Exercised against a real local PostgreSQL 17 (`RUN_INTEGRATION_TESTS=1`) |
| Deployment tested   | Exercised on the deployed API with real configuration                    |
| Production verified | Observed under real production traffic                                   |
| Blocked             | Needs owner access, paid infrastructure, or a production window          |

## 1. Scheduling reliability — implemented, integration tested, outcome B

### Root causes of stranded idle-account work

1. The processor was only invoked by API traffic or the **daily** Vercel drain
   cron. An idle account had no clock.
2. Scheduled emails were enqueued as jobs that were **runnable immediately**, so
   the processor claimed them before `scheduled_for`, the drain skipped them as
   not due, and the job completed — leaving the email without any wake-up.
3. Transient email failures returned the row to `queued` with **no backoff** and
   unchanged `scheduled_for`, so retries re-ran immediately and burned attempts.
4. Webhooks had **no handler in the API processor**. Deliveries were written and
   enqueued on the legacy BullMQ queue only; the deployed system never delivered
   them.
5. The legacy webhook consumer classified every non-2xx as retryable and kept
   no per-attempt history.

### What changed

- Scheduled email jobs are enqueued with `delayMs` equal to the send delay, so
  `jobs.available_at` matches `emails.scheduled_for`.
- `emails.next_attempt_at` separates customer schedule from retry eligibility.
  Transient failures get exponential backoff with jitter (30s base, 1h cap),
  while `scheduled_for` is never rewritten.
- The processor performs bounded reconciliation every run:
  - `repairDueEmailJobs`: queued, due emails with no pending/processing
    `email.send` job get one repair wake-up per email per minute.
  - `repairMissingWebhookJobs`: due pending deliveries with no live
    `webhook.deliver` job get one.
- `runQueueProcessor` is bounded: 25 jobs, chunks of 5, 45 s budget, release
  unstarted claims without consuming attempts, and records every invocation in
  `queue_processor_runs`.
- New `GET /v1/jobs/status` exposes pending/due/retrying/expired-lease/dead
  letter counts, oldest pending/due age, webhook backlog, and last successful and
  failed runs.
- New `GET /v1/jobs/dead-letter` plus reprocess endpoints for jobs and deliveries.
- **Owner decision: cron-job.org every minute (primary) + GitHub Actions every
  five minutes (secondary).** cron-job.org is authenticated
  with `QUEUE_PROCESSOR_SECRET`; scheduler-triggered runs use a 15s budget so
  its 30s free-tier timeout cannot cut off work. It is a real scheduler but has
  no SLA and no retries.
- `.github/workflows/queue-processor.yml` (every 5 minutes, authenticated with
  `QUEUE_PROCESSOR_SECRET`) calls the same bounded processor as a secondary.
- The existing daily `/v1/cron/drain` also runs a 20-second processor pass.
  Vercel Hobby allows only two cron jobs, so no third schedule was added;
  `POST /v1/cron/process` exists for manual use but is not scheduled.

### Outcome B, stated plainly

A reliable $0 scheduler was **not** found. Vercel Hobby cron is daily; GitHub
Actions schedules are best-effort, can be delayed indefinitely and are disabled
after 60 days of repository inactivity; uptime pings are not schedulers.
Chosen outcome is **B**: the safest best-effort mechanism above, with:

- typical latency **5–60 seconds + processing** with cron-job.org, **0–10
  minutes** with GitHub Actions;
- worst case **unbounded** if the external scheduler is down, delays, or
  suspends the job; the daily Vercel cron is the only long-stop;
- a guarantee requires Vercel Pro minute cron, an always-on worker, or another
  paid scheduler, each with its own alerting.

Scheduler failure is visible as a stale `processor.lastSuccess` (or a growing
`jobs.oldestDueAgeSeconds`) in `/v1/jobs/status`. Recovery is a manual
`POST /v1/jobs/process`; no work is lost while the scheduler is down.

## 2. Webhook lifecycle — implemented, integration tested

- Event vs attempt: `webhook_deliveries.id` is the event id (`webhook-id`);
  `webhook_delivery_attempts` is append-only HTTP history. Retries never create
  a new event.
- Durable event + durable `webhook.deliver` job on the Postgres queue.
- Stable body: the stored envelope is sent byte-for-byte on every attempt.
- HMAC-SHA256 over `timestamp.body`, header `webhook-signature: t=…,v1=…`.
- Per-attempt rows (outcome, HTTP status, latency, sanitized error).
- Response policy: 2xx delivered; 400/401/403/404/405/410/413/414/415/422
  permanent; other statuses and network errors retryable; 8 attempts with
  `5s, 30s, 120s, 600s, 1800s, 7200s, 21600s` backoff.
- Leases: `pending → sending` with `lock_expires_at`; expired sends recover to
  `pending`. A late result from a processor that lost its lease is rejected.
- Disabled/deleted endpoint and undecryptable secret are explicit permanent
  outcomes; no request is made.
- Dead-letter inspection and reprocess endpoints; delivered events are refused.
- Tenant checks: a job whose `projectId` differs from the delivery's project is
  rejected without an HTTP request.
- Secrets are never written to attempt rows or logs; URLs are redacted.

No exactly-once claim is made. A crash after the endpoint accepts a request but
before the attempt row commits is ambiguous and will be retried. Receivers must
dedupe on `webhook-id`.

## 3. Acceptance tests against real PostgreSQL

Run:

```bash
DATABASE_URL=postgres://calder@127.0.0.1:5432/calder \
RUN_INTEGRATION_TESTS=1 corepack pnpm --filter @calder/api test
```

New files:

- `apps/api/src/lib/processor.integration.test.ts` — 8 tests
- `apps/api/src/lib/webhook-delivery.integration.test.ts` — 14 tests
- `apps/api/src/routes/jobs.integration.test.ts` — 4 tests (HTTP trigger)

The outbound HTTP client is mocked in the webhook suite; the database, leases,
state transitions and signing are real. No deployed scheduler or provider is
verified by these tests.

### Queue scenarios (11)

| #   | Scenario                                      | Test                                                                  |
| --- | --------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Due scheduled mail found without new traffic  | discovers due scheduled mail with no traffic…                         |
| 2   | No early execution                            | same test + does not claim a job before available_at…                 |
| 3   | Retryable work becomes eligible automatically | respects retry backoff… / does not claim a job before available_at…   |
| 4   | Expired lease recovered after a crash         | recovers work from a crashed processor's expired lease                |
| 5   | Safe concurrent claiming                      | lets concurrent processors run without duplicate claims               |
| 6   | No permanently stranded pending work          | repairs a missing email wake-up idempotently                          |
| 7   | Bounded batch and runtime                     | stops at its runtime budget and releases unstarted claims             |
| 8   | Trigger failures visible and recoverable      | exposes dead letters, requeues them, and records failed runs          |
| 9   | UTC / instant semantics                       | discovers due scheduled mail… (explicit offset, future row untouched) |
| 10  | Dedupe via idempotent transition              | repairs a missing email wake-up idempotently                          |
| 11  | Dead-letter inspect + safe reprocess          | exposes dead letters… + authenticated trigger suite                   |

### Webhook scenarios (14)

| #   | Scenario                                    | Test                                                         |
| --- | ------------------------------------------- | ------------------------------------------------------------ |
| 1   | Durable event + delivery job                | persists a durable event and a delivery job…                 |
| 2   | Success → delivered                         | delivers on 2xx…                                             |
| 3   | Signed request                              | signs the exact stored body with HMAC…                       |
| 4   | Per-attempt record                          | delivers on 2xx… (`webhook_delivery_attempts`)               |
| 5   | Status recorded safely (lease owner only)   | rejects a stale result…                                      |
| 6   | Retryable → auto retry                      | retries a retryable response with backoff…                   |
| 7   | Permanent policy (4xx)                      | treats 4xx configuration errors as permanent…                |
| 8   | Max attempts + backoff                      | enforces the attempt cap… / strictly increasing schedule     |
| 9   | Stable payload across retries               | retries a retryable response… (byte-identical)               |
| 10  | Crash-safe lease recovery                   | recovers a delivery whose attempt lease expired…             |
| 11  | Dead-letter inspect + reprocess             | lists terminal failures… / never duplicates the event id…    |
| 12  | Tenant isolation                            | isolates tenants…                                            |
| 13  | Disabled endpoint explicit policy           | treats a disabled endpoint as an explicit permanent decision |
| 14  | No secrets in stored records / no duplicate | signs the exact stored body… / never duplicates the event id |

Scheduler → processor integration is additionally covered by
`src/routes/jobs.integration.test.ts` (401 without secret, 503 when unset, 200
with the real bounded run, trigger label sanitization, status/dead-letter shape).

## 4. Evidence summary

| Claim                                              | Status                                |
| -------------------------------------------------- | ------------------------------------- |
| Queue claim/lease/backoff/repair logic             | Integration tested                    |
| Scheduled email not executed early                 | Integration tested                    |
| Webhook state machine, signing, retry policy       | Integration tested                    |
| Processor HTTP trigger and observability           | Integration tested                    |
| GitHub Actions and Vercel cron definitions         | Implemented                           |
| Deployed scheduler firing every 5 minutes          | **Deployment tested: no**             |
| Deployed webhook reaching a customer endpoint      | **Deployment tested: no**             |
| Real SES / real webhook receiver under production  | **Production verified: no / Blocked** |
| Vercel Hobby cron configuration accepted by Vercel | **Blocked** (needs deploy)            |
| GitHub `QUEUE_PROCESSOR_SECRET` configured         | **Blocked** (needs owner)             |

Setup runbook: [`docs/SCHEDULER-SETUP.md`](./SCHEDULER-SETUP.md).

## 5. Owner actions required before a guarantee can be claimed

1. Create the cron-job.org job (every minute, POST, bearer header,
   `x-calder-trigger: scheduler`, failure notifications), and add
   `QUEUE_PROCESSOR_SECRET` as a GitHub Actions secret plus optional
   `CALDER_API_URL`.
2. Deploy the API and confirm `vercel.json` accepts the two existing cron paths.
3. Curl `GET /v1/jobs/status` with the secret after 10 minutes and confirm
   `processor.lastSuccess` advances.
4. Point one webhook endpoint at a controlled receiver and confirm attempt rows,
   signatures, and retry timing.
5. Choose a guarantee path if minute-level latency matters: Vercel Pro cron,
   an always-on worker, or another scheduler with alerting.

## 6. Verdict

**Implementation complete; deployment verification pending.** The local
acceptance suite covers all 11 queue scenarios and all 14 webhook scenarios
against real PostgreSQL, plus the authenticated scheduler → processor path. No
evidence is claimed for deployed cron execution, real webhook networks, SES, or
production traffic.
