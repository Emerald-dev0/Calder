# Avenor — How the System Works

> **Living document. Rule: every backend change updates this file in the same
> commit.** If code and this file disagree, the code is right and this file is
> a bug — fix the file. Last updated: Redis pipeline cutover (see §9).

## 1. The system in one picture

```
Client (SDK / SMTP / dashboard)
  │  POST /v1/emails + Bearer key + Idempotency-Key
  ▼
API (Hono, :3002) ── validate → auth → idempotency-check → persist email ( Postgres )
  │  enqueue { emailId, projectId }
  ▼
Queue (Redis via BullMQ; InMemory ONLY in tests/single-process dev)
  │  worker pulls job
  ▼
Worker ── load email (tenant-scoped) → suppression check → provider.send()
  │  SES if AWS creds, else Mock (dev/test keys never touch SES)
  ▼
Events persisted (sent/delivered/bounced/…) → webhooks queued → usage metered
  │
  ▼
Dashboard reads Postgres. Nothing reads the queue except the worker.
```

Golden rule: **the last mile is always a provider (SES/mock). Internal mail
enters at enqueue time, never by looping the worker back into the API.**

## 2. Request lifecycle: sending an email (full trace)

1. `POST /v1/emails` hits `apps/api/src/routes/emails.ts`.
2. `authMiddleware` hashes the Bearer key (SHA-256 + pepper), looks it up in
   `api_keys`, rejects revoked keys, attaches `{ apiKeyId, projectId,
organizationId, env }`. No key → 401. Wrong project → 403.
3. `rateLimitMiddleware("sending")` checks Redis counters (100/min/key).
4. `sendEmailSchema` (zod) validates the body. Invalid → 400 with code
   `validation_error`. Every error is `{ error: { code, message, request_id } }`.
5. `handleSendEmail` (`apps/api/src/services/email-service.ts`):
   - Idempotency: `(projectId, key)` lookup in `idempotency_keys`. Hit →
     return stored response, send nothing. This is what makes retries safe.
   - Persist `emails` row (`status: queued`) + `email_events` row (`queued`).
   - Enqueue `{ emailId, projectId }` on `email:send`. **Durable first, queue
     second** — a crash between them is reconciled, never silently lost.
   - Returns `202 { id, status: queued }`.
6. Worker (`apps/worker/src/worker.ts`) picks up the job from Redis:
   - Loads the email scoped to the job's `projectId` (tenant check — a job can
     never send another project's mail).
   - Checks `suppressions`. Suppressed → status `suppressed` + event, no send.
   - Calls the provider. Transient failure → requeue with exponential backoff +
     jitter (max 5). Permanent failure → status `failed` + event, no retry.
     Exhausted → dead-letter state (reason, attempts, last error, replayable).
   - Success → status `sent` + `providerMessageId`, event recorded, webhook job
     enqueued, usage counted.
7. Test keys (`avenor_sk_test_…`) force the Mock provider end-to-end: same code
   path, zero external delivery.

## 3. Auth: two doors, one building

- **API keys** (`packages/auth/src/api-keys.ts`): `avenor_sk_{test,live}_` +
  48 hex chars of `randomBytes`. Stored as SHA-256 hex (not bcrypt — verified
  per-request, must be fast), compared with `timingSafeEqual`. Prefix stored
  for identification. Rotation = create new + revoke old; revocation is immediate.
- **OAuth sessions** (`packages/auth/src/oauth.ts` + `session.ts`): Google/GitHub
  via `arctic` (standard flows, `state` validated constant-time). Unverified
  provider emails can never hijack an existing account. Sessions are opaque rows
  (`ses_*`, 30d TTL, revocable); the cookie holds only an iron-session-sealed id
  (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
- **Authorization** (`packages/auth/src/authorization.ts`): `requireProjectAccess`,
  `requireOrgAccess`, `assertTenantScope` — enforced at the data-access layer,
  never only in middleware. A request from org A cannot read/modify/infer org B.

## 4. Data: what lives where

- **Postgres (source of truth):** users, oauth_accounts, sessions, organizations,
  organization_members, projects, api_keys, smtp_credentials (planned),
  domains, domain_verifications, emails, email_events, suppressions,
  idempotency_keys, webhooks, webhook_deliveries, usage_records, plans,
  plan_prices, subscriptions, otp_challenges, templates, audit_logs, waitlist_signups.
- **Redis (acceleration only):** queue jobs, rate-limit counters, key-context
  cache (60s), verification-state cache. If Redis dies: sends fail closed with
  diagnosable errors; reads fall through to Postgres. Redis is never the billing record.
- **Migrations:** `packages/db/drizzle/000N_*.sql` + journal, applied via Drizzle
  CLI. Additive only. Current: `0000_init`, `0001_waitlist`, `0002_auth`.

## 5. Dogfooding doctrine (corrected)

Our own mail (waitlist confirmations, onboarding, billing) goes through the SAME
`POST /v1/emails` path as customers — test keys in staging, live keys in prod.
There is no special internal bypass and no self-calling provider: a previous
iteration (`AvenorEmailProvider` HTTP-looping worker→API→queue→worker) was
removed because it recursed and faked `accepted: true`, corrupting the event
trail the whole system exists to keep honest. The stub class remains as a seam
that throws until a direct-enqueue delegation exists; the worker selects only
SES/mock as last-mile providers.

## 6. What's REAL vs what's STUB (honest inventory)

| Component                                             | Status                                                   |
| ----------------------------------------------------- | -------------------------------------------------------- |
| API validation/auth/rate-limit/error model            | Real                                                     |
| Idempotency (durable keys, replay)                    | Real                                                     |
| Redis queue (BullMQ) API↔worker delivery              | Real (this cutover)                                      |
| Worker retry/backoff/DLQ/suppression/events           | Real                                                     |
| SES provider                                          | Real code, needs AWS creds + sandbox warm-up to fire     |
| Mock provider (test keys)                             | Real, full-path simulation                               |
| OAuth login, sessions, linking                        | Real code, needs provider console creds to click through |
| Orgs/projects/keys/domains/webhooks API               | Real CRUD, tenant-scoped                                 |
| Webhook delivery engine (signed, retried, replayable) | Partial — enqueue exists, dedicated deliverer pending    |
| Usage aggregation cron                                | Planned (Phase 8)                                        |
| Billing charges (Bachs)                               | Abstraction + mock only; provider unvalidated            |
| SMTP gateway                                          | Specified (`docs/SMTP.md`), not built                    |
| Templates / OTP                                       | Schema stubs + docs; not built                           |
| Dashboard pages beyond overview                       | Shells; data wiring in progress                          |

## 7. How to run it (local truth)

```bash
docker compose up -d            # Postgres :5432, Redis :6379
cp .env.example .env            # then set AUTH_SECRET (32+ chars)
pnpm install
pnpm --filter @avenor/db db:migrate
pnpm dev                        # api :3002, worker, web :3000, dashboard :3001
```

## 8. How to prove a send works (the pipeline test)

```bash
# 1. Seed one org/project/key directly (no signup UI yet):
psql $DATABASE_URL -c "INSERT INTO organizations(id,name,slug) VALUES ('org_demo','Demo','demo')"
#    … projects, api_keys (hash via node -e using @avenor/auth hashApiKey)
# 2. Send:
curl -X POST localhost:3002/v1/emails -H "Authorization: Bearer <key>" \
  -H "Idempotency-Key: demo-1" -H "Content-Type: application/json" \
  -d '{"from":"app@demo.test","to":"you@test.test","subject":"hi","text":"hi"}'
#    → 202 { id }
# 3. Watch the worker log consume it (mock provider, ~100ms).
# 4. Assert in Postgres: emails.status='sent', email_events has queued+sent,
#    idempotency_keys row exists. Re-POST same key → 200, no new email row.
```

## 9. Changelog (newest first)

- **Redis pipeline cutover:** `createQueue` returns BullMQ-backed queue when
  `REDIS_URL` is set; InMemory kept for tests only (prod import = bug, guarded).
  API-enqueued jobs now actually reach the worker process. Verified per §8
  (live: 202 → Redis → worker → mock → `sent` + events + idempotent replay).
- BullMQ forbids `:` in queue names — backend names sanitize to `-`, logical
  names stay canonical. Redis queue instances are shared per name (BullMQ opens
  a connection per instance; per-call instances would leak).
- **Dogfood correction:** removed worker self-provider switch; documented doctrine (§5).
- **Auth backend:** OAuth + sessions + migrations (see §3).
- **Waitlist:** public signup with durable idempotent tickets (see API route).
