# 00 — Inventory (email scope)

Date: 2026-10-02. Repo root: `/home/emerald/Desktop/Avenor`. Audit-only, no code modified.
Scope note (owner, 2026-10-02): **email only for now**. SMS/OTP/push/inbound-marketing items are out of scope and marked OOS where they appear. The vision docs still promise multi-channel; those promises are flagged as roadmap, not MVP.

## 1. Apps in `apps/` (4 — no smtp-gateway)

| App | Path | Entry | Verdict |
|---|---|---|---|
| web (marketing) | `apps/web` | `apps/web/app/page.tsx:19` | REAL — landing + ~40 routes |
| dashboard | `apps/dashboard` | `apps/dashboard/app/(app)/layout.tsx:84` | REAL |
| api | `apps/api` | `apps/api/src/app.ts:38` (`createApp`), `apps/api/src/index.ts`, `apps/api/src/serverless.ts` | REAL — 16 route mounts |
| worker | `apps/worker` | `apps/worker/src/index.ts:9`, `apps/worker/src/worker.ts:524` (`startWorker`), health `:3003` | REAL — 2 consumers |

**smtp-gateway: ABSENT as an app.** Spec only: `docs/SMTP.md:1-3` ("Status: specified, not yet implemented"); ADR-014 (`docs/DECISIONS.md:116-139`) plans `apps/smtp-gateway` — never created; `docs/ROADMAP.md:39` confirms it "DOES NOT EXIST"; dashboard is honest (`apps/dashboard/app/(app)/smtp/page.tsx:6-10,28-32`, "no host to connect to"). `ARCHITECTURE.md` §5b describes it as if live — docs/code mismatch, see finding SMTP-001.

## 2. API routes (`apps/api/src/app.ts:80-96` mounts)

| Mount | File | Method + path |
|---|---|---|
| `/` → health | `routes/health.ts` | `GET /v1/openapi.json` (:32), `GET /health` (:36), `GET /ready` (:52) |
| `/v1/emails` | `routes/emails.ts` | `POST /v1/emails/` (:13), `GET /v1/emails/:id` (:69), `GET /v1/emails/` (:110) |
| `/v1/emails/batch` | `routes/batch.ts` | `POST /v1/emails/batch/` (:16) |
| `/v1/domains` | `routes/domains.ts` | `POST /` (:19), `GET /` (:72), `POST /:id/verify` (:84), `POST /:id/token` (:151), `DELETE /:id` (:176), `POST /:id/ses/link` (:193), `POST /:id/ses/refresh` (:246) |
| `/v1/projects` | `routes/projects.ts` | `GET /v1/projects/` (:7) |
| `/v1/webhooks` | `routes/webhooks.ts` | `POST /` (:17), `GET /` (:56), `DELETE /:id` (:73), `POST /:id/rotate` (:90), `GET /:id/deliveries` (:107), `POST /:id/deliveries/:deliveryId/replay` (:139) |
| `/v1/waitlist` | `routes/waitlist.ts` | `POST /` (:156), `GET /position` (:304), `GET /count` (:319) |
| `/v1/beacon` | `routes/beacon.ts` | `POST /v1/beacon/` (:27, always-204, ≤20 events) |
| `/v1/admin` | `routes/admin.ts` | `POST /waitlist/broadcast` (:72), `GET /organizations` (:220), `POST /organizations/:orgId/subscription` (:252), `GET/PUT /waitlist/confirmation` (:289/:314) — all `adminAuthMiddleware` |
| `/v1/unsubscribe` | `routes/unsubscribe.ts` | `GET /` (:34, browser click), `POST /` (:56, RFC 8058 one-click) |
| `/v1/senders` | `routes/senders.ts` | `GET /` (:33), `POST /` (:47), `GET /:id` (:131), `PATCH /:id` (:147), `DELETE /:id` (:188), `POST /:id/default` (:204), `POST /:id/test` (:230) |
| `/v1/keys` | `routes/keys.ts` | `GET /` (:31), `POST /` (:46), `POST /:id/revoke` (:84) |
| `/v1/templates` | `routes/templates.ts` | `GET /` (:50), `POST /` (:68), `GET /:id` (:121), `DELETE /:id` (:137), `GET /:id/versions` (:153), `POST /:id/versions` (:188) |
| `/v1/suppressions` | `routes/suppressions.ts` | `GET /` (:14), `POST /` (:34), `DELETE /:id` (:56) |
| `/v1/cron` | `routes/cron.ts` | `GET+POST /v1/cron/drain` (:32), `GET+POST /v1/cron/aggregate-usage` (:45) — bearer `CRON_SECRET`/`ADMIN_API_KEY`, prod-mandatory (:9-22) |
| `/v1/ses` | `routes/ses-events.ts` | `POST /v1/ses/events` (:31, SNS-signature auth, not API-key) |

## 3. DB tables (`packages/db/src/schema/*.ts`, 18 files → 34 tables)

Enums: `schema/enums.ts:3-113` (org role, key env, domain status/verification method, email stream/status/event type, webhook event/delivery status, plan tier, subscription status, suppression reason, otp purpose, transport type/status, sender type/status, platform role, waitlist status).

| Table | File:line | Key columns |
|---|---|---|
| `users` | `users.ts:4` | id, email!unique, username?unique, role, onboarding_*, platformRole?, emailVerifiedAt, passwordHash?, failedLoginAttempts, lockedUntil |
| `organizations` | `organizations.ts:5` | id, name, slug!unique |
| `organization_members` | `organizations.ts:13` | org→cascade, user→cascade, role (owner/admin/member) |
| `org_invitations` | `invitations.ts:10` | org→cascade, email, role, tokenHash!unique, invitedBy, acceptedAt, expiresAt (7d) |
| `projects` | `projects.ts:10` | org→cascade, name, slug, metadata{environment,useCases,monthlyVolume} |
| `api_keys` | `api-keys.ts:5` | project→cascade, name, keyPrefix, scope (full/send/read), keyHash!unique, env (test/live), lastUsedAt, expiresAt, revokedAt |
| `emails` | `emails.ts:15` | project→cascade, idempotencyKey (unique per project), from/to/cc/bcc/replyTo, subject, html/text, metadata, attachments(≤10/25MB), scheduledFor, stream, status, providerMessageId, env (test/live), transport, provider, lastError, attemptCount |
| `email_events` | `emails.ts:78` | email→cascade, project→cascade, type, data |
| `suppressions` | `emails.ts:99` | project→cascade, email, reason; unique(project,email) |
| `idempotency_keys` | `emails.ts:119` | project→cascade, key, responseStatus/Body, expiresAt (24h) |
| `otp_challenges` | `emails.ts:137` | project→cascade, email, codeHash, purpose, expiresAt, attempts/maxAttempts, verifiedAt (OOS-email-scope: email-OTP infra exists; SMS-OTP does not) |
| `domains` | `domains.ts:14` | project→cascade, domain, status, verificationMethod/Token, verifiedAt, challenge bookkeeping, sesIdentityStatus, dkimRecords, dkimStatus; unique(project,domain) |
| `domain_verifications` | `domains.ts:44` | domain→cascade, method, status, proof |
| `sender_identities` | `senders.ts:20` | project→cascade, displayName, email, type, transportId→set-null, status(+Reason), isDefault; unique(project,email) |
| `project_transports` | `transports.ts:24` | project→cascade, type (gmail/ses/managed), status (active/suspended/revoked), encryptedCredentials (AES-256-GCM), dailyCap, isDefault |
| `webhooks` | `webhooks.ts:14` | project→cascade, url, secret (encrypted), events[], enabled |
| `webhook_deliveries` | `webhooks.ts:31` | webhook→cascade, project→cascade, event, payload, status, attemptCount, latencyMs, responseStatus, nextAttemptAt, lastError, deliveredAt |
| `provider_events` | `providers.ts:15` | provider (default ses), snsMessageId!unique (dedupe), sesMessageId, eventType, emailId→set-null, projectId→set-null, recipient, payload, unmatched |
| `templates` / `template_versions` | `system.ts:27/:47` | project→cascade; name, alias (send-by-alias); version, subject/html/text |
| `audit_logs` | `system.ts:5` | org?→set-null, project?→set-null, actorUserId, action, targetType/Id, metadata |
| `plans` / `plan_prices` | `billing.ts:14/:22` | tier!unique (free/starter/pro/scale); plan→cascade, currency (NGN/USD), amountCents, interval |
| `subscriptions` | `billing.ts:37` | org→cascade, plan, status, providerSubscriptionId/CustomerId (Bachs), currentPeriodStart/End |
| `usage_records` | `billing.ts:59` | org→cascade, projectId?, metric, quantity, periodStart/End |
| `usage_summaries` | `billing.ts:83` | deterministic id `ur_agg_<org>_<metric>_<period>` (:86), rollups |
| `oauth_accounts` / `sessions` | `sessions.ts:16/:37` | user→cascade; provider+providerUserId unique; expiresAt, revokedAt, userAgent, ip, lastSeenAt |
| `magic_link_tokens` | `sessions.ts:63` | email, tokenHash!unique (sha256), expiresAt, consumedAt |
| `email_code_challenges` | `sessions.ts:83` | email, codeHash, purpose (verification/reset), expiresAt (10min), attempts/max(5), consumedAt |
| `analytics_events` | `analytics.ts:14` | PII-free pageview/cta/form events + edge country |
| `waitlist_signups` + `waitlist_confirmation*` | `waitlist.ts:24/53/66/78` | email!unique, referralCode!unique; live template + drafts + versions |

Notably absent: `smtp_credentials`, `credit_ledger`, `provider_accounts` (only `provider_events` exists).

## 4. Dashboard sidebar (`apps/dashboard/app/(app)/layout.tsx:21-82`, 18 items)

| Item | href | Verdict + evidence |
|---|---|---|
| Overview | `/` | REAL — `app/(app)/page.tsx` renders |
| Email | `/emails` | REAL — `emails/new/composer.tsx:285-366` working composer + `emails/new/actions.ts` |
| Templates | `/templates` | REAL — `templates/editor.tsx:119-209` + versions API |
| Senders | `/senders` | REAL — `add-sender.tsx:146-197` + Gmail connect |
| Inbox | `/inbox` | STUB — `inbox/page.tsx:1,12-22` renders only `PlanGate` |
| Webhooks | `/webhooks` | REAL — `manager.tsx:58` + replay route `routes/webhooks.ts:139` |
| API Keys | `/keys` | REAL — `manager.tsx:55` + revoke `routes/keys.ts:84` |
| SDKs | `/sdks` | PARTIAL — `sdks/page.tsx:9-42` snippets only; no published packages |
| SMTP | `/smtp` | STUB (honest) — `smtp/page.tsx:28` "not available yet" |
| Domains | `/domains` | REAL — `domains/manager.tsx:69` + DKIM columns |
| Integrations | `/integrations` | PARTIAL — Gmail card real (`:29-31`); GitHub + Vercel "Soon" (`:45,59`) |
| Deliveries | `/deliveries` | REAL — `deliveries/page.tsx:1-60` tenant-scoped query + pagination |
| Analytics | `/analytics` | STUB — `analytics/page.tsx:12-22` only `PlanGate` |
| Suppressions | `/suppressions` | REAL — `manager.tsx:61` + unique index `schema/emails.ts:114` |
| Usage | `/usage` | REAL — `usage/page.tsx:1-50` live snapshot + ledger |
| Audit Logs | `/audit-logs` | REAL — filtered live query (`:83`) |
| Settings | `/settings` | REAL — workspace-forms, team, sessions |
| Control Plane | `/control` (founder) | REAL (gated) — `layout.tsx:86-89` + `docs/CONTROL-PLANE.md` |

## 5. Marketing site (`apps/web/app`)

Sections (`page.tsx:19-47`): Navigation, Hero, StackStrip, Opening, Pipeline, SmtpSection, BeginnerSection, Developers, Streams, Capabilities, ProductTour, Pricing, FinalCta, Footer.
Routes: `/`, `/about`, `/blog`, `/blog/[slug]`, `/brand`, `/changelog`, `/developers`, `/docs` (+ concepts/sending/domains/templates/api-keys/idempotency/suppression/security/deliverability/otp/usage-billing/examples/api-reference/gmail-quickstart/webhooks/smtp, + quickstart/{nodejs,go,cli,ruby,python,curl,php}), `/domains`, `/legal/{privacy,terms}`, `/migrate`, `/pricing`, `/resources/glossary`, `/security`, `/status`, `/support`, `/templates`, `/waitlist`, `/webhooks`, `/what-is-calder` (+ `robots.ts`, `sitemap.ts`).

## 6. Background jobs / cron

| Job | Trigger | Code | Notes |
|---|---|---|---|
| `email:send` consumer | long-lived worker, Redis (BullMQ) / InMemory locally | `apps/worker/src/worker.ts:524-535` (maxAttempts 5), `index.ts:20` | load (tenant-scoped `:222-226`) → suppression check (`:284-315`, fail-closed) → transport chain (`:324-332`, test-env mock-only) → persist sent event + `recordSendUsage` (`:410-438`) → webhook enqueue (`:537-550`); transient retry w/ backoff (`:483-491`), dead-letter (`:492-519`), missing-row drop (`:266-276`) |
| `webhook:deliver` consumer | same worker process | `webhook-consumer.ts:185-192` | HMAC sign-once (`:11-14`), SSRF guard (`:23-49`), 10s timeout (`:8`), `WEBHOOK_MAX_ATTEMPTS` + backoff (`:5,105-117`) |
| `/v1/cron/drain` (delivery drain) | Vercel Cron daily midnight + immediate `kickDrain` post-accept | `apps/api/vercel.json:3`, `routes/cron.ts:32-37`, `lib/drain.ts:305-565`, `lib/kick-drain.ts:31-75` (debounced 1500ms) | `FOR UPDATE SKIP LOCKED` claim (`drain.ts:267-299`), batch 25 (`:26`), max 5 attempts (`:27`), stale-claim 10min (`:67`); exactly-once metering via deterministic ledger id (`:492-493`) |
| `/v1/cron/aggregate-usage` | route exists, **NO schedule** | `routes/cron.ts:45-56` | must be invoked manually until scheduled |
| Gmail velocity/abuse watch | inline in drain + worker pre-send | `drain.ts:129-130`, `worker.ts:127` | limit/suspend verdicts terminal, never silent SES fallback |
| SES feedback ingress | SNS → API (event-driven) | `routes/ses-events.ts:31-80`, `lib/ses-events.ts` | RSA verify + topic allowlist, idempotent apply |
| Analytics retention purge (13mo) | ABSENT | `schema/analytics.ts:12` "documented follow-up" | No code |

## 7. Email content, env, third parties

**In-repo campaigns:** `apps/api/src/campaigns/waitlist-update-001.ts`, `founder-intro.ts`; registry `CAMPAIGNS` in `routes/admin.ts:60-64`; broadcast `POST /v1/admin/waitlist/broadcast` with per-recipient idempotency + signed unsubscribe. Dynamic waitlist confirmation tables (`waitlist.ts:53-90`) + admin `GET/PUT /waitlist/confirmation`.

**Env vars (`.env.example:1-66`):** `NODE_ENV`, `LOG_LEVEL`, `APP_URL`, `FOUNDER_EMAILS`, `DASHBOARD_URL`, `API_URL`, `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` (32+ chars prod), `AUTH_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_DOMAIN`, `AUTH_EMAIL_FROM`, `SES_SNS_TOPIC_ARNS`, `SES_CONFIGURATION_SET`, `BACHS_API_KEY`, `BACHS_WEBHOOK_SECRET`, `BACHS_API_URL`, `ADMIN_API_KEY`, `WEBHOOK_SIGNING_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `WORKER_HEALTH_PORT`, `WORKER_CONCURRENCY`.

**Third parties:** AWS SES (+SNS, SESv2) REAL (`packages/providers/src/ses.ts`); Gmail API REAL (`packages/providers/src/gmail.ts`); Google+GitHub OAuth REAL (`packages/auth/src/oauth.ts`); Vercel REAL infra; Redis REAL interface w/ InMemory fallback; Postgres REAL; Bachs PARTIAL (interface + mock only, "pending validation"); Resend/Postmark MENTIONED ONLY as SMTP baseline, not integrated.

## 8. Scorecard — marketing claims

REST send REAL; idempotency REAL; retries REAL; signed+retried webhooks REAL; suppression REAL; domain verify + DKIM/SES REAL; templates REAL; Gmail no-domain start REAL (capped). **OVERCLAIM:** "Two ways in — SMTP keeps working, identical tracking" (`components/smtp-section.tsx:18-20,64`) presented as live vs `docs/SMTP.md:1` not implemented. Inbound email ABSENT (Inbox stub). Advanced analytics ABSENT-as-UI. NGN/USD pricing PARTIAL (prices table real, no chargeable provider). Open/click tracking PARTIAL (SES-feedback only, no pixel/click injection). Vercel hosted-domain verification PARTIAL (enum exists, Integrations card "Soon").
