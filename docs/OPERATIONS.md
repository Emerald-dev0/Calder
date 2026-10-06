# Operations

Last reviewed: 2026-10-05 (Phase 2, production reliability). Anything marked
`OWNER ACTION REQUIRED` has not been verified by an engineer in this repository
and must be done by the account owner before launch. Nothing here claims a
verification that did not happen.

## 1. Health and readiness

| Endpoint                                   | Process | Semantics                                                                                                                                                                   |
| ------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                              | API     | **Liveness.** Answers 200 whenever the process can respond. Never touches the database, Redis or the provider, so a dependency outage cannot cause a restart loop.          |
| `GET /ready`                               | API     | **Readiness.** 200 only when the checks required to do the job safely pass; 503 otherwise. Details are scrubbed of credentials.                                             |
| `GET /v1/openapi.json`                     | API     | Serves the OpenAPI spec (also the fastest "is this the right deployment" probe).                                                                                            |
| `GET /v1/cron/alerts`                      | API     | Alert sweep (see §5). `CRON_SECRET`-guarded. Returns **503** when any critical alert is firing, so an uptime monitor can page without parsing JSON. 200 = nothing critical. |
| `POST /v1/cron/drain`                      | API     | Postgres-backed drain (the delivery backstop). `CRON_SECRET`-guarded.                                                                                                       |
| `GET /health`, `GET /ready`, `GET /status` | worker  | Liveness / readiness / operational snapshot (job counters, queue metrics, alerts). `WORKER_HEALTH_PORT`, default 3010.                                                      |

API `/ready` checks, in order:

1. **email provider** — required (production only; a mock provider in production is not ready);
2. **database** — required always (`select 1`);
3. **queue/Redis** — required in staging/production. If `REDIS_URL` is unset there, `/ready` reports degraded (boot already refuses to start; this is defence in depth);
4. **worker heartbeat** — informational; `WORKER_EXPECTED=false` skips it entirely (serverless deploys deliver through the drain);
5. **rate limiter posture** — informational; `degraded` when the Redis limiter has fallen back to per-instance counting (ADR-041);
6. **error tracking** — informational; `skipped` when no `SENTRY_DSN` is set (failures are logged, not shipped).

Worker `/ready` checks the queue driver, a Redis `PING`, `select 1`, and the age
of its own heartbeat. A worker that has never published a heartbeat is **not**
ready: a process that boots and cannot reach its queue must not look healthy.

## 2. Redis requirement matrix (§6–7)

| Process           | development / test   | staging / production              |
| ----------------- | -------------------- | --------------------------------- |
| `apps/api`        | optional (in-memory) | **required** — boot fails without |
| `apps/worker`     | optional (in-memory) | **required** — boot fails without |
| thin drain (cron) | optional (in-memory) | **required** — boot fails without |
| `apps/dashboard`  | not used             | not used                          |
| `apps/web`        | not used             | not used                          |
| local scripts     | optional             | n/a                               |

`CALDER_ENV` (`development|test|staging|production`) selects the posture and
defaults to `NODE_ENV`; a contradiction (for example `NODE_ENV=production`
with `CALDER_ENV=development`) is a boot error, not a silent choice.

There is **no** production escape hatch. `createQueue()` throws
`QueueConfigurationError` in a hosted environment without `REDIS_URL`; it never
falls back to the in-process queue. In development/test it uses the in-process
queue and logs a one-line warning, because that is the documented behaviour
there, and the alternative (a developer needing Redis for a unit test) is worse.

Documented behaviour when Redis is unavailable: see §4.

## 3. Queue lifecycle and crash matrix (§9)

Lifecycle of one send:

```
API: validate → eligibility (org/project/suppression/quota) → idempotency
     → INSERT emails(status=queued) + email_events(queued)   [committed]
     → enqueue onto Redis (email:send)
worker: claim → re-check eligibility → provider.send()
     → UPDATE status=sent|failed + email_events(sent|failed)
     → recordSendUsage (deterministic id) → webhook deliveries
drain (cron): FOR UPDATE SKIP LOCKED claims queued rows + 10-minute lease;
     the same provider + persistence path as the worker.
```

| Failure point                                        | What happens                                                                                                                                                                                | Operator-visible                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| API crashes after admission, before enqueue          | Row is committed as `queued`. The scheduled drain delivers it; nothing is lost. Idempotency is not consumed (no usage row).                                                                 | Slow delivery only; `queued_email_age` alert if it stays queued past the threshold.                                            |
| Enqueue fails (Redis down/rejected/timeout)          | **The send is still accepted (202).** The row stays `queued`; `queue_enqueue_failures` increments, the failure is logged and reported. Never metered.                                       | `queue_enqueue_failures` alert (critical), `/ready` degraded, request log line "Enqueue failed; send remains queued…".         |
| Worker crashes before provider accepts               | BullMQ retries (max 5 attempts, exponential backoff ≈2s). The row stays `queued`, no usage row. After exhaustion the job dead-letters → `failed`.                                           | `worker_no_heartbeat` if the worker is gone; `worker_repeated_job_failures` / `queue_dlq_growth` for repeated failures.        |
| Worker crashes after provider accepts, before commit | Retry re-sends. This is the one place a duplicate could be delivered; with SES this is rare and is the accepted at-least-once trade-off (see §6).                                           | A duplicate `email_events(sent)` row for the same email is only possible if the retry also succeeds; usage stays exactly once. |
| Redis disappears mid-flight                          | Producer fails fast (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`, enqueue timeout); consumer reconnects forever and resumes when Redis returns. Accepted sends wait in Postgres. | `redis_unavailable` (critical), `/ready` 503, enqueue failures if sends are arriving.                                          |
| Provider timeout / 5xx                               | Classified as transient → retried with backoff; sustained failures raise `provider_failure_sustained`. Permanent rejections fail immediately.                                               | Provider alerts, worker logs with error code, `emails.lastError`.                                                              |
| Retries exhausted                                    | Job is dead-lettered; `emails.status='failed'` with the last error; no usage row. Replay is manual after the cause is fixed.                                                                | `queue_dlq_growth`, dashboard timeline shows the failure.                                                                      |
| Organization suspended/paused while queued           | The drain/worker re-checks eligibility before the provider call and fails the send closed with `organization_sending_unavailable`; keys are revoked by the suspension action.               | Audit trail + `email.failed` webhook; no provider delivery, no usage row.                                                      |
| Duplicate job (redelivery, double enqueue)           | The provider send is preceded by an eligibility + status check; a terminal row is not re-sent. Metering is keyed on the email id, so a second drain cannot double-bill.                     | `usage_records` has exactly one row per sent email.                                                                            |

Do not "fix" a backlog by marking rows successful. Failed/unattempted mail is
failed/unattempted; the recovery path is always the queue or the drain.

## 4. Failure behaviour (§8)

- **Sends are never silently dropped.** A `202` means the durable row exists.
  Delivery may be delayed; it is never fabricated, and it is never metered
  before a provider accepts it.
- **No fake queueing.** In hosted environments the in-process queue does not
  exist; there is no switch to fall back to.
- **No false success.** `/ready` is 503 while a required dependency is down.
  The worker's readiness is 503 when its own heartbeat is stale.
- **Failures are observable.** Every enqueue failure increments
  `queue_enqueue_failures` and is captured with the standard Calder error shape
  (`{ error: { code, message, request_id } }` for HTTP;
  `classifyError` for logs/reporting).
- **Undelivered mail is not metered.** `recordSendUsage` runs only after a
  provider acceptance, keyed `ur_<emailId>`, so re-runs cannot double-count.

## 5. Alerts (§15)

Rules are defined once in `@calder/observability` (`ALERT_CATALOG`) and
evaluated by `GET /v1/cron/alerts` (API, every 5 minutes) and by the worker for
the signals only it can see. Thresholds are environment variables, so they are
configurable per environment without a deploy.

| Alert                          | Severity | Trigger                                                                    | Meaning                                                            | What to check                                                      | First response                                                |
| ------------------------------ | -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `redis_unavailable`            | critical | Redis `PING` fails or times out                                            | Durable delivery is stalled; sends still accepted                  | Redis provider status, connection limits, `REDIS_URL`              | Follow the Redis outage runbook (§8); do not deploy during it |
| `database_unavailable`         | critical | `select 1` fails                                                           | Full outage: nothing can be accepted or delivered                  | Provider status, `DB_POOL_MAX`, recent migrations, disk            | Database outage runbook (§8)                                  |
| `queue_enqueue_failures`       | critical | Enqueue failures ≥ `QUEUE_ENQUEUE_FAILURE_WARN` (5) in window              | Accepted mail is waiting for the drain, not lost                   | Redis availability, producer timeout `REDIS_ENQUEUE_TIMEOUT_MS`    | Fix Redis; then confirm `/v1/cron/drain` clears the backlog   |
| `queue_depth_high`             | warning  | Waiting jobs > `QUEUE_DEPTH_WARN` (500)                                    | Consumers are behind, or a burst arrived                           | Worker count/concurrency, provider latency, recent deploy          | Scale consumers or raise `WORKER_CONCURRENCY`                 |
| `queue_oldest_job_stale`       | critical | Oldest waiting job older than `QUEUE_OLDEST_JOB_WARN_MINUTES` (15)         | No consumer is making progress                                     | Worker heartbeat/status, worker logs, Redis                        | Restart/scale the worker; verify one email reaches `sent`     |
| `queue_dlq_growth`             | warning  | Exhausted (failed) jobs > `QUEUE_DLQ_WARN` (50)                            | A shared cause is failing deliveries                               | Worker logs grouped by error code, provider status                 | Fix the cause, then replay affected emails                    |
| `queued_email_age`             | critical | Oldest `queued` email older than the drain threshold                       | Delivery stopped at the source (cron, credentials)                 | Cron schedule, `/v1/cron/drain` response, provider credentials     | Run the drain manually and watch the counts                   |
| `worker_no_heartbeat`          | critical | No heartbeat fresher than `WORKER_HEARTBEAT_STALE_SECONDS` (120)           | The consumer is not running (skipped when `WORKER_EXPECTED=false`) | Worker process/host, worker `/health`, `/ready`                    | Restart the worker                                            |
| `worker_repeated_job_failures` | warning  | Exhausted jobs ≥ `WORKER_JOB_FAILURE_WARN` (10) in window                  | Bad deploy, credentials or provider problem                        | Recent deploy, credentials, provider status                        | Roll back if it began at a deploy; otherwise fix and replay   |
| `api_5xx_rate`                 | critical | 5xx share ≥ `API_5XX_WARN_PERCENT` (5%) with ≥ `API_5XX_MIN_REQUESTS` (20) | The API is failing requests                                        | Error tracking grouped by classification, recent deploy, readiness | Roll back first if it started at a deploy, diagnose second    |
| `api_latency_degraded`         | warning  | p95 latency ≥ `API_LATENCY_WARN_MS` (3000) over the window                 | Degradation, often a dependency or a hot query                     | Readiness detail, database latency, recent deploy                  | Investigate before it becomes an outage                       |
| `provider_failure_sustained`   | critical | Provider failures ≥ `PROVIDER_FAILURE_WARN` (10) in window                 | Deliverability is broken (SES throttle, credentials)               | SES console, credentials, sending quota, provider latency          | Stop the bleeding (pause sends), then fix and replay          |

Alerting channel: `OWNER ACTION REQUIRED` — choose the paging destination
(email, Slack, PagerDuty) and point it at `GET /v1/cron/alerts` (503 = page) and
the worker `/status` endpoint. Calder does not ship a vendor integration; the
endpoint is the integration point.

## 6. Exactly-once metering and idempotency (§10)

- `usage_records.id = ur_<emailId>` and `onConflictDoNothing`: a re-delivered job
  or a second drain can never create a second metering row. Regression coverage:
  `apps/e2e/src/critical-flow.e2e.test.ts` (idempotency replay + exactly-one row)
  and `apps/api/src/lib/drain.integration.test.ts`.
- HTTP idempotency: an `Idempotency-Key` replay returns the original send with
  200 and does not create a second email row (`emails` unique per project+to
  assertion in the same suite).
- Provider acceptance is the only point that meters. Queue retries before
  acceptance produce no usage row.
- The one accepted at-least-once window is "worker crashed after the provider
  accepted but before the status commit" (§3). It can duplicate a provider
  delivery; it cannot duplicate billing.

## 7. Backups, RPO/RTO, restore drills (§16–18)

Verify what the provider actually offers; do not trust marketing copy.

```bash
node scripts/backup-verify.mjs        # read-only capability + tooling report
```

Provider capability (this script cannot see a provider console):

- `OWNER ACTION REQUIRED` — Database provider: confirm and record, in this file,
  that automated backups **and** point-in-time recovery are enabled, with the
  retention window. Recommended: Neon (branching + PITR) or AWS RDS
  (automated backups + PITR). Paste the provider setting, not a marketing claim.
- `OWNER ACTION REQUIRED` — Redis: decide whether queue state needs a backup at
  all. It does not: Postgres is the source of truth for accepted mail and the
  drain re-delivers anything Redis lost. Record that decision here.

Targets (provisional, owner approval required):

| Target | Value                                                      | Basis                                                                                           |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| RPO    | ≤ 5 minutes (managed PITR)                                 | It is the provider's continuous PITR granularity; anything worse must be approved deliberately. |
| RTO    | ≤ 2 hours for the database, ≤ 30 minutes for API readiness | Restore time depends on provider tooling that has not been drilled yet.                         |

Restore drill (must run against a scratch database, never production data):

```bash
# 1. capability + tooling report
node scripts/backup-verify.mjs

# 2. take a dump (read-only against the source) and restore into a scratch db
node scripts/restore-drill.mjs --from-database \
  --target postgresql://user:pass@host:5432/calder_restore_drill

# 3. inspect the restored migration journal explicitly
DATABASE_URL=postgresql://.../calder_restore_drill pnpm --filter @calder/db db:status
```

The drill refuses to run against a database that does not look like a scratch
database (name must contain drill/restore/scratch/test), never drops anything,
and writes `restore-drill-report.json` with the steps it actually performed. A
drill that could not run reports **failed** with the reason; that is not
evidence, and it must not be presented as one. Delete the report when you have
recorded the outcome in this file.

Status: **not yet performed — OWNER ACTION REQUIRED.** No provider credentials
and no `pg_dump`/`pg_restore` tooling are available in the environment where
Phase 2 was implemented, so no restore has been proven. `scripts/backup-verify.mjs`
currently reports exactly that. Do not launch publicly until one restore has
been drilled and the evidence recorded below.

Drill evidence log (append one block per drill: date, operator, source, target,
dump size, result, time to restore):

```
(no drills recorded)
```

## 8. Incident runbooks (§25)

Every runbook: symptoms → immediate checks → containment → recovery →
verification → escalation → post-incident. Escalation is the same everywhere:
the founder on call is reached through the ops channel (`OWNER ACTION REQUIRED`:
record the channel and the on-call rotation here). Never page by emailing a
customer.

### 8.1 API outage / 5xx spike

- **Symptoms**: `api_5xx_rate`, customer reports, `/ready` 503, uptime monitor red.
- **Immediate checks**: `GET /health` (process alive?), `GET /ready` (which check is degraded?), recent deploys.
- **Containment**: if it began at a deploy, roll back first (§9 in `DEPLOYMENT.md`). If a dependency is down, follow that runbook.
- **Recovery**: fix or roll back; do not deploy a fix onto a degraded deployment.
- **Verification**: `/ready` 200, `GET /v1/cron/alerts` 200, one `POST /v1/emails` accepted and delivered.
- **Escalation**: if >15 minutes of downtime, notify all customers with an ETA; status page banner.
- **Post-incident**: postmortem within 48 hours.

### 8.2 Redis outage

- **Symptoms**: `redis_unavailable`, `queue_enqueue_failures`, `/ready` 503, sends accepted but not delivered promptly.
- **Immediate checks**: Redis provider status, `REDIS_URL`, connection limits, whether the drain still runs (`/v1/cron/drain`).
- **Containment**: nothing to disable — accepted mail waits in Postgres and the drain delivers it. If the drain is also overwhelmed, raise its batch/interval; do not mark rows sent.
- **Recovery**: provider fix or failover to a replica; the worker reconnects automatically.
- **Verification**: `redis_unavailable` clears, queue depth falls, oldest waiting age drops, one queued email reaches `sent`.
- **Escalation**: if the outage exceeds 30 minutes, consider announcing delivery delays.
- **Post-incident**: count and confirm all delayed mail drained (`queued` count back to baseline, `queued_email_age` clear).

### 8.3 Database outage

- **Symptoms**: `database_unavailable`, `/ready` 503 on `database`, everything failing.
- **Immediate checks**: provider status, connection count vs `DB_POOL_MAX`, disk, recent migrations.
- **Containment**: do not deploy. The API will accept nothing; the queue stops consuming (worker readiness 503).
- **Recovery**: provider restore/failover; if data loss is involved, follow §8.9.
- **Verification**: `select 1` works, `/ready` 200, migrations show no drift (`pnpm db:status`), a test send flows.
- **Escalation**: immediate.
- **Post-incident**: reconcile counts (`emails` by status, `usage_records`) against expectations.

### 8.4 Queue backlog / worker not consuming

- **Symptoms**: `queue_depth_high`, `queue_oldest_job_stale`, dashboard shows queued sends.
- **Immediate checks**: worker `/status` (heartbeat, counters), worker logs, provider latency, `WORKER_EXPECTED`.
- **Containment**: restart or scale the worker; if the provider is throttling, pause sending rather than burning attempts.
- **Recovery**: after the cause is fixed, let the queue drain; the drain also processes Postgres-queued rows.
- **Verification**: depth decreasing, oldest job age < threshold, one email `sent`, `queue_dlq_growth` not rising.
- **Escalation**: if a customer's campaign is affected, tell them before they ask.
- **Post-incident**: review whether retry/backoff thresholds need tuning.

### 8.5 Worker failure / crash loop

- **Symptoms**: `worker_no_heartbeat`, `worker_repeated_job_failures`, worker restarting.
- **Immediate checks**: worker `/health`, `/ready` (driver, Redis, DB), logs around the crash, recent deploy, memory limits.
- **Containment**: stop the crash loop (roll back/pause the queue consumer) so the drain can take over delivery.
- **Recovery**: fix the cause, restart one worker, watch a job complete.
- **Verification**: heartbeat fresher than the threshold, `/ready` 200, DLQ not growing.
- **Escalation**: if the worker cannot start and the drain cannot keep up, declare a partial outage.
- **Post-incident**: capture the crash's error classification and add a regression test when possible.

### 8.6 Provider (SES) outage

- **Symptoms**: `provider_failure_sustained`, delivery failures, SES errors in worker logs.
- **Immediate checks**: SES console (quota, throttling, sandbox), credentials, DKIM/identity status, region.
- **Containment**: transient failures retry automatically; on sustained failure pause sending for the affected orgs so attempts are not wasted.
- **Recovery**: provider resolution or credential rotation (deploy new credentials to api + worker).
- **Verification**: a real test send reaches `sent`, bounce/complaint events still arrive (SNS path), usage rows return.
- **Escalation**: if SES is down in-region, consider a secondary region only with the owner's decision.
- **Post-incident**: record the SES error codes and the pause/raise timeline.

### 8.7 Abuse incident (org sending spam / compromised key)

- **Symptoms**: bounce/complaint alert, `organization.sending.auto_paused` audit rows, support complaints, unusual send volume.
- **Immediate checks**: control plane org detail (recent events, accepted-send denominator), API key usage, acquisition source.
- **Containment**: Control Plane → Organizations → Sending safety → Suspend sending (revokes keys, blocks sends, fails queued mail closed) or `POST /v1/admin/organizations/:orgId/sending-status` with a reason.
- **Recovery**: only after review; issue replacement keys rather than restoring revoked ones.
- **Verification**: no sends from the org, queued mail failed closed, no usage rows for blocked mail.
- **Escalation**: notify the owner immediately; check whether our reputation is at risk (§ `docs/PHASE1-ABUSE.md`).
- **Post-incident**: postmortem + threshold review.

### 8.8 Bad deployment

- **Symptoms**: post-deploy verification failure, 5xx spike, error-tracking volume, readiness degraded right after a deploy.
- **Immediate checks**: run `pnpm verify:deploy -- --url <prod>` from a machine with network access.
- **Containment**: roll back (see `docs/DEPLOYMENT.md` § Rollback). Forward-only migrations are never reverted destructively.
- **Recovery**: redeploy the last good build; if a migration ran, verify it is backward-compatible with the old code before rolling back.
- **Verification**: verification script green, alerts clear, one send delivered end to end.
- **Escalation**: if rollback is not possible, communicate the ETA and freeze further deploys.
- **Post-incident**: add the missing pre-deploy check to CI.

### 8.9 Data recovery (corruption or accidental deletion)

- **Symptoms**: missing rows, provider reports data loss, a bad migration.
- **Immediate checks**: confirm the scope (table, time window), stop writes to the affected path if possible, check whether PITR is available.
- **Containment**: **do not** run destructive SQL. Freeze the deployment and capture the current state.
- **Recovery**: restore to a scratch database first (drill script), inspect, then copy rows back rather than overwriting production.
- **Verification**: row counts and a sample of affected records, usage/exactly-once integrity (`ur_<emailId>` ids), migration status.
- **Escalation**: owner decides on the restore point; a restore can lose up to the RPO window.
- **Post-incident**: postmortem; if the cause was a migration, re-read `AGENTS.md`'s migration rules.

### 8.10 Dependency or secret-scanning finding

- **Symptoms**: dependency audit reports a high/critical advisory, Gitleaks reports a credential, or a provider reports suspicious credential use.
- **Immediate checks**: stop the release; identify the advisory path or secret issuer and the first commit containing it. Do not copy secret values into logs, tickets, or chat.
- **Containment**: for a secret, revoke/rotate it at the issuer before removing repository copies. For a vulnerable dependency, disable the affected feature or isolate the affected deployment only when the security owner approves the mitigation.
- **Recovery**: upgrade to a patched dependency and regenerate the lockfile, or record a time-bound advisory-ID exception with owner, exposure, mitigation, and deadline. Remove leaked material from repository history where feasible.
- **Verification**: rerun `node scripts/security-audit.mjs`, the Gitleaks CI scan, relevant tests, and `pnpm launch-check`; review audit logs for use of the exposed credential and validate replacement credentials in a safe environment.
- **Escalation**: security owner and founder/on-call immediately for any production secret or high/critical advisory; assess customer notification and provider disclosure obligations.
- **Post-incident**: record root cause, rotation/revocation timestamps, affected access window, customer/provider notifications, and a prevention test or CI rule.

## 9. Deployment verification and rollback

- Pre-deploy: `pnpm launch-check` (blocking); migrations before code
  (`pnpm --filter @calder/db db:migrate`, then `pnpm db:status` to prove no drift).
- Post-deploy: `pnpm verify:deploy -- --url https://api.calder.click` (health,
  readiness, OpenAPI, auth rejection, optional mock test send, alert sweep).
  It never emails a customer: the send check requires a `calder_sk_test_` key.
- Rollback: `docs/DEPLOYMENT.md` § Rollback.

## 10. Status page (§26)

`apps/web/app/status/page.tsx` is static and previously implied live component
instrumentation the system cannot prove. It now states only what is true:
API and worker endpoints exist and are monitored internally; per-component
uptime history is not published yet. `OWNER ACTION REQUIRED`: point the page (or
its replacement) at real data before advertising a status URL publicly.

## 11. Browser-level end-to-end tests (§22–24)

HTTP-level end-to-end coverage is real and runs in CI
(`apps/e2e`, `RUN_INTEGRATION_TESTS=1`):

- account journey: signup → verification code → verify → login (session cookies),
  disposable-email rejection, wrong-code/wrong-password rejection;
- onboarding writes: organization + project + API key;
- send → Postgres → Redis → worker → mock provider → delivery state → exactly-once
  metering → webhook fan-out, idempotent replay, suppression;
- Redis outage: durable acceptance, no metering, drain delivers when Redis returns;
- readiness honesty and credential redaction.

Browser-level (Playwright) coverage is **not yet implemented**: the environment
used for this phase cannot download browser binaries
(`playwright.azureedge.net`/`cdn.playwright.dev` are unreachable), and no test
may be reported as passing that never ran. To add it: install `@playwright/test`
in `apps/e2e`, run `pnpm exec playwright install chromium` on a machine with
network access, and drive the same journeys through the UI. Until then, do not
claim browser E2E coverage.

## 12. OWNER ACTION REQUIRED (§30)

| Action                                          | Provider / system      | Exact setting                                                                           | Why                                                         | Verification                                                                        |
| ----------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Enable automated backups + PITR, note retention | Database provider      | Backups/PITR: on; retention ≥ 7 days (record the exact window here)                     | A bad migration or corruption is unrecoverable without it   | Run `node scripts/backup-verify.mjs`; paste console evidence into §7                |
| Perform and record one restore drill            | Database provider      | Scratch database, `node scripts/restore-drill.mjs --from-database --target …_drill`     | Backup configuration is not proof of recoverability         | `restore-drill-report.json` says `passed`; append to the §7 evidence log            |
| Provision production Redis                      | Redis provider         | `REDIS_URL` (`rediss://`) set on api and worker for staging and production              | Boot now refuses to start in hosted environments without it | `pnpm launch-check` queue check passes; `/ready` shows queue ok                     |
| Create an error-tracking project and DSN        | Sentry (or equivalent) | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` on api and worker                  | Failures are logged but not centrally grouped or paged      | Trigger a test exception; it appears with `request_id`/`service`/`environment` tags |
| Choose the alert destination                    | Paging tool            | Monitor `GET /v1/cron/alerts` (503 = page) and worker `/status`; set `CRON_SECRET`      | Twelve alert rules exist but nothing is paged yet           | Force a failure (e.g. stop Redis) and confirm the page arrives                      |
| Record the on-call rotation and severity levels | Ops channel            | Named rotation, severity definitions, postmortem template                               | §25 runbooks say who to escalate to; today nobody is named  | Publish in this file and test one page                                              |
| Approve RPO/RTO targets                         | Business               | Sign off §7 numbers or replace them                                                     | Recovery expectations must be owned, not assumed            | Approval recorded here with a date                                                  |
| Rehearse rollback once                          | Hosting                | Deploy to preview, run `pnpm verify:deploy -- --url <preview>`, roll back, verify again | The rollback runbook is unexercised                         | Record the rehearsal date and outcome                                               |
| Verify production env after first deploy        | Hosting                | `vercel env pull .env.production.local --environment=production && pnpm launch-check`   | Missing credentials are the historical launch risk          | launch-check exits 0                                                                |
