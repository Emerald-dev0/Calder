# Scheduler setup — cron-job.org + GitHub Actions

Operating decision: **cron-job.org every minute (primary)** and **GitHub Actions
every five minutes (secondary)**. The existing daily Vercel drain is a backstop.
All three call the same bounded processor; none is a guarantee (see
`docs/QUEUE.md` §8).

This runbook assumes the API is deployed at `https://api.calder.click`.

## 0. Prerequisites

1. Migrations `0038_silly_iron_man.sql` and `0039_white_lady_mastermind.sql`
   applied to the production database.
2. A dedicated processor secret — **not** `CRON_SECRET`, not `ADMIN_API_KEY`:

   ```bash
   openssl rand -hex 32
   ```

   Store the output somewhere safe for the next steps. Never commit it or paste
   it into a document.

3. The API deployed with the new code.

## 1. Vercel environment variables

In the **calder-api** Vercel project → Settings → Environment Variables:

| Name                     | Value                         | Environments                                    |
| ------------------------ | ----------------------------- | ----------------------------------------------- |
| `QUEUE_PROCESSOR_SECRET` | the 64-character secret       | Production (and Preview only if you test there) |
| `QUEUE_SCHEDULER_MODE`   | `cron-job.org+github-actions` | Production                                      |
| `CRON_SECRET`            | existing value                | Production                                      |

Redeploy after saving. An unset `QUEUE_PROCESSOR_SECRET` makes the processor
return `503 processor_disabled`; a wrong value returns `401`.

Verify from your machine:

```bash
export SECRET='<the 64-character secret>'
curl -sS -X POST \
  -H "Authorization: Bearer $SECRET" \
  -H "x-calder-trigger: manual" \
  https://api.calder.click/v1/jobs/process
```

Expect HTTP 200 and JSON containing `runId`, `trigger: "manual"`,
`runtimeBudgetMs: 45000`, and counters. Then:

```bash
curl -sS -H "Authorization: Bearer $SECRET" \
  https://api.calder.click/v1/jobs/status
```

Expect `200` and `processor.schedulerMode: "cron-job.org+github-actions"`.

## 2. cron-job.org (primary)

1. Create an account at <https://cron-job.org> and verify the email address.
2. **Create cronjob** with:
   - **Title:** `Calder queue processor`
   - **URL:** `https://api.calder.click/v1/jobs/process`
   - **Schedule:** every 1 minute (`* * * * *` in expert mode)
   - **Request method:** `POST`
   - **Request body:** empty
   - **Headers:**
     - `Authorization` = `Bearer <the 64-character secret>`
     - `x-calder-trigger` = `scheduler`
   - **Timeout:** 30 seconds (the free-tier maximum)
   - **Enabled:** yes
3. Enable failure notifications (email, and webhook/Slack/Telegram if offered).
4. Save, then use **Test run** / **Execute now** and confirm the response is
   HTTP 200 with `trigger: "scheduler"` and `runtimeBudgetMs: 15000`.
5. Check the execution history after two minutes: the job should run every
   minute and return 200.

Free-tier limits that matter: no SLA, 4–40s scheduling jitter, 30s timeout, no
retries, 2-day execution history, and the service stores the header containing
the processor secret. Use only the dedicated, rotatable secret.

The processor deliberately uses a **15s budget** for scheduler-triggered runs so
cron-job.org cannot record a false timeout while work is still running. If a
manual run is needed, use the `manual` trigger (45s budget).

## 3. GitHub Actions (secondary)

### 3.1 Add the secret

Repository → **Settings → Secrets and variables → Actions → Secrets → New
repository secret**:

| Name                     | Value                        |
| ------------------------ | ---------------------------- |
| `QUEUE_PROCESSOR_SECRET` | the same 64-character secret |

Optional repository **variable** (not a secret), under the **Variables** tab:

| Name             | Value                      |
| ---------------- | -------------------------- |
| `CALDER_API_URL` | `https://api.calder.click` |

Or with the GitHub CLI:

```bash
gh secret set QUEUE_PROCESSOR_SECRET --repo Emerald-dev0/Calder
gh variable set CALDER_API_URL --repo Emerald-dev0/Calder \
  --body "https://api.calder.click"
```

### 3.2 Enable the workflow

The workflow file is `.github/workflows/queue-processor.yml` and runs every five
minutes (`*/5 * * * *`) plus manual dispatch.

**Important:** GitHub only runs scheduled workflows from the **default branch**
(`main`), and disables schedules after 60 days without repository activity. The
workflow must be merged to `main` before its schedule is active. Until then,
test the endpoint with the curl command in §1.

After merging:

```bash
gh workflow run queue-processor.yml --repo Emerald-dev0/Calder --ref main
gh run list --workflow queue-processor.yml --repo Emerald-dev0/Calder --limit 3
```

The run must finish green; the log prints the JSON counters (never the secret)
and fails on a non-2xx response.

## 4. Verification checklist

| Check                                         | Expected                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /v1/jobs/process` with the secret       | 200, `runId` starts `qpr_`                                                 |
| Without the secret                            | 401                                                                        |
| With `QUEUE_PROCESSOR_SECRET` unset in Vercel | 503 `processor_disabled`                                                   |
| `GET /v1/jobs/status`                         | 200; `schedulerMode` label; `lastSuccess` present                          |
| Wait 2 minutes, check status again            | `processor.lastSuccess` advances; `recent` includes `trigger: "scheduler"` |
| cron-job.org history                          | HTTP 200 every minute                                                      |
| GitHub Actions manual run                     | Green; HTTP 200                                                            |
| Create a queued email, wait one minute        | Email moves to `sent` without customer traffic                             |

Longer soak: leave both schedulers running for several hours, then confirm
`jobs.oldestDueAgeSeconds` stays bounded and `jobs.deadLetter` does not grow
unexpectedly.

## 5. Rotation and troubleshooting

**Rotate the secret:** set the new value in Vercel first and redeploy, then update
cron-job.org and the GitHub secret. Brief 401s are expected while the external
schedulers still hold the old value; the queue is durable, so no work is lost.
Use a maintenance window or overlap only if the provider supports multiple
headers, which it does not.

| Symptom                               | Cause / fix                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `401` from cron-job.org               | Header is not exactly `Bearer <secret>`; hidden newline, stale value, or trailing space                        |
| `503 processor_disabled`              | `QUEUE_PROCESSOR_SECRET` missing in Vercel or the deployment was not redeployed                                |
| `404`                                 | Wrong host/path; use `https://api.calder.click/v1/jobs/process`                                                |
| `405`                                 | cron-job.org method is GET; switch to POST                                                                     |
| cron-job.org marks timeouts           | Confirm the run is using the scheduler budget (15s) and that the route is not blocked by deployment protection |
| GitHub Actions never runs on schedule | Workflow is not on `main`, Actions are disabled, or the repository has had no activity for 60 days             |
| `lastSuccess` stops advancing         | Check both scheduler histories, then run the manual curl and inspect Vercel function logs                      |
| `deadLetter` grows                    | Inspect `GET /v1/jobs/dead-letter`; requeue only after fixing the cause                                        |
