# Calder — How the System Works

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
7. Provider selection is currently GLOBAL to the worker process: SES if AWS
   creds are present, else Mock. Per-email test/live routing is NOT yet
   implemented — in dev (no SES creds) everything flows through Mock; in prod
   with SES creds everything would send for real. Test-key simulation must
   become per-email before untrusted users onboard.

## 3. Auth: two doors, one building

- **API keys** (`packages/auth/src/api-keys.ts`): `calder_sk_{test,live}_` +
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

Our own mail goes through the same persist → enqueue → worker → event path as
customer mail, via `sendInternalEmail()` (`apps/api/src/services/email-service.ts`)
under the founder-owned tenant (`org_avenor` / `proj_website`, seeded by
`pnpm --filter @calder/db db:seed`). First live consumer: waitlist confirmations
(position + referral code, idempotency key `waitlist-confirm:<email>` so replays
never duplicate; signup succeeds even if the confirmation fails). There is no
special bypass and no self-calling provider: a previous iteration
(`CalderEmailProvider` HTTP-looping worker→API→queue→worker) was removed because
it recursed and faked `accepted: true`, corrupting the event trail the whole
system exists to keep honest. The stub class remains as a seam that throws; the
worker selects only SES/mock as last-mile providers. Verified live: waitlist join
→ confirmation row under `proj_website` → worker → `sent` + events. Founder
claims the account by signing in with an email listed in `FOUNDER_EMAILS`
(auto-owner of `org_avenor` on first login).

## 6. What's REAL vs what's STUB (honest inventory)

| Component                                             | Status                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| API validation/auth/rate-limit/error model            | Real                                                          |
| Idempotency (durable keys, replay)                    | Real                                                          |
| Redis queue (BullMQ) API↔worker delivery              | Real (this cutover)                                           |
| Worker retry/backoff/DLQ/suppression/events           | Real                                                          |
| SES provider                                          | Real code, needs AWS creds + sandbox warm-up to fire          |
| Mock provider (test keys)                             | Real, full-path simulation                                    |
| OAuth login, sessions, linking                        | Real code, needs provider console creds to click through      |
| Orgs/projects/keys/domains/webhooks API               | Real CRUD, tenant-scoped                                      |
| Webhook delivery engine (signed, retried, replayable) | Partial — enqueue exists, dedicated deliverer pending         |
| Usage aggregation cron                                | Planned (Phase 8)                                             |
| Billing charges (Bachs)                               | Abstraction + mock only; provider unvalidated                 |
| SMTP gateway                                          | Specified (`docs/SMTP.md`), not built                         |
| Templates / OTP                                       | Schema stubs + docs; not built                                |
| Dashboard auth (OAuth login, sessions, middleware)    | Real code; needs GOOGLE/GITHUB console creds to click through |
| Dashboard reads (overview stats, emails list)         | Real, server components via tenant helper (ADR-015)           |
| Dashboard domains/keys/webhooks/usage/billing         | Shells; data wiring pending                                   |

## 7. How to run it (local truth)

```bash
docker compose up -d            # Postgres :5432, Redis :6379
cp .env.example .env            # then set AUTH_SECRET (32+ chars)
pnpm install
pnpm --filter @calder/db db:migrate
pnpm dev                        # api :3002, worker, web :3000, dashboard :3001
```

## 8. How to prove a send works (the pipeline test)

```bash
# 1. Seed one org/project/key directly (no signup UI yet):
psql $DATABASE_URL -c "INSERT INTO organizations(id,name,slug) VALUES ('org_demo','Demo','demo')"
#    … projects, api_keys (hash via node -e using @calder/auth hashApiKey)
# 2. Send:
curl -X POST localhost:3002/v1/emails -H "Authorization: Bearer <key>" \
  -H "Idempotency-Key: demo-1" -H "Content-Type: application/json" \
  -d '{"from":"app@demo.test","to":"you@test.test","subject":"hi","text":"hi"}'
#    → 202 { id }
# 3. Watch the worker log consume it (mock provider, ~100ms).
# 4. Assert in Postgres: emails.status='sent', email_events has queued+sent,
#    idempotency_keys row exists. Re-POST same key → 200, no new email row.
```

## 8b. Dashboard data pattern (ADR-015)

Dashboard pages are Next.js Server Components that query Postgres directly
through `getTenantContext()` (`apps/dashboard/lib/auth.ts`): session cookie →
sealed id → validated row (expiry + revocation) → memberships → projects. Every
query is scoped to the user's own projects; `resolveProject` rejects foreign
project ids. Rationale: server components run on the server, so this is a BFF
read, not client DB access; routing every dashboard read through HTTP to our own
API would add latency and a second auth mechanism for zero isolation benefit
(the tenant helper IS the enforcement point). Mutations stay in server actions
with the same helper. Middleware checks cookie presence only (fast path).

## 8c. Onboarding wizard (`/onboarding`)

Six steps, profile first: who you are (name, unique handle, role, referral
source → `users` + migration `0004`) → organization → project (+environment,
use-cases, volume in `projects.metadata`) → test key (secret shown once) →
first send (via the public API with the fresh key, status polled until terminal,
arrival animation on success) → domain (real records, real DNS check via
`resolveTxt`, honest pending state). Progress is derived from data, not stored
separately — re-runnable, resumable; `onboarding_completed_at` stamps the finish.
Every server action re-checks membership; usernames are case-insensitive unique.

Five steps, each unlocking the next because the data model requires it:
organization → project (+environment, use-cases, volume stored in
`projects.metadata`) → test key (secret shown once) → first send (via the
public API with the fresh key, status polled until terminal, arrival animation
on success) → domain (real records, real DNS check via `resolveTxt`, honest
pending state). Progress is derived from data, not stored separately —
re-runnable, resumable. Server actions enforce membership on every step.

## 9. Changelog (newest first)

- **Auth proven without provider creds:** `session.integration.test.ts`
  (`RUN_INTEGRATION_TESTS=1`) covers seal→validate→revoke→expired + founder
  bootstrap grant/no-op against live Postgres (9/9 green). Only the OAuth
  redirect dance itself still needs console creds.
- **Dev-login backdoor** (`POST /api/auth/dev-login` + login-page form):
  dev-only (`NODE_ENV!=production` AND `ALLOW_DEV_LOGIN=true`), creates/finds
  user + runs founder bootstrap. Proven live: dev 307 → dashboard renders founder
  org (owner of `avenor`); production build returns 403. Never enable in prod.
- **Blog is MDX-driven:** registry (`posts.ts`) + one `.mdx` per post + dynamic
  `[slug]` route (+ redirect for the old slug). New post → registry entry +
  file, then notify waitlist via the admin broadcast (manual, founder-curated).
  Requires `@next/mdx@14` + `@mdx-js/{loader,react}` + `@types/mdx` (pinned to
  Next 14 — latest `@next/mdx` targets Next 16 and breaks the build).
- **Resend parity note:** Resend login = Google + GitHub + email/password
  (verified). GitHub OAuth stays: our users authenticate with GitHub daily and
  it yields verified developer emails.
- **Onboarding wizard:** org → project (+metadata via 0003) → test key → first
  real send → domain with live DNS verification.
- **Dashboard data pages:** domains (add + live DNS check), API keys (create
  once-shown secret, revoke), webhooks (create with AES-GCM-encrypted secrets,
  enable/disable), usage (live counts + plan tiers). Server/client split rule:
  `node:` modules never cross into `"use client"` bundles (crypto in actions
  only, pure constants in shared files). Webpack Edge lesson recorded: middleware
  must not import the auth barrel.

- **Dogfood loop live:** waitlist confirmations send through the pipeline under
  `org_avenor/proj_website`, visible in the dashboard emails list; founder
  bootstrap via `FOUNDER_EMAILS`; dashboard login/callback/logout + overview
  stats + emails list wired to tenant helper.
- **Position-0 bug:** Postgres stores µs, driver round-trips ms — re-read
  timestamps missed by fractions of a ms. Fixed by setting `createdAt`
  explicitly at insert (exact-ms values compare exactly).

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
- **Bulk doctrine (waitlist nurture):** custom headers ride in `metadata.headers`,
  allowlisted in `sanitizeHeaders` (List-Unsubscribe(-Post), X-* only — envelope
  smuggling impossible); worker threads them to the provider (SES maps them).
  Signed one-click unsubscribe (`GET` page + RFC 8058 `POST`), suppressions
  scoped per project. Admin broadcast (`ADMIN_API_KEY` bearer, unset = 503)
  skips suppressed addresses, per-recipient idempotency keys
  (`broadcast:<campaign>:<email>`), rendered `{{placeholders}}`, versioned
  campaign content in `apps/api/src/campaigns/`. Verified live: 4 queued +
  1 skipped, all sent, re-run added zero rows.
- **Local infra note:** compose now declares `calder` PG creds but the existing
  volume was initialized as `avenor` — running services must match the volume
  (`DATABASE_URL=postgresql://avenor:avenor@…`) until someone recreates it
  (`docker compose down -v`, destroys dev data).
