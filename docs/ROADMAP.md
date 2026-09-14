# CALDER ENGINEERING ROADMAP

Status: Proposed execution plan (v1). Authoritative for _sequencing and scope only_.
Product scope: `PRD.md`. System design: `ARCHITECTURE.md`. Security: `SECURITY.md`.
If this file ever contradicts those, they win, see § Document Conflict Register.

## Executive Summary

Calder is ~40% toward a production MVP, not at zero. The scaffold already delivers:
monorepo + CI, Drizzle schema + initial migration, Hono API (validate → persist →
enqueue → 202), worker (retry/backoff, dead-letter), SES provider behind an
abstraction, API-key auth, idempotency, rate limiting, billing abstraction, landing
site + public pages, brand system.

What remains is the production spine: **real queue backend, OAuth identity,
durable retry/DLQ state, live SES path, webhook delivery engine, usage metering,
validated billing, completed dashboard, SDKs, abuse controls, load validation.**
The roadmap sequences that work in 14 phases across 8 parallel tracks, with the
golden path (signup → first delivered email → webhook) as the prioritization key.

Deliberate stance: **modular monolith until triggers fire** (ADR-007). One API
deployable, one worker deployable. No Kubernetes, no Kafka, no service mesh in MVP.

Public launch status (2026-09-14): pricing locked (ADR-024), marketing email
promoted to a first-class stream on the same pipeline (ADR-025), and the sending
path made fail-loud (ADR-026). Campaigns, audiences and automations move from
"future architecture" to the top of the post-launch queue, ahead of SDKs,
inbound email and the CLI.

## Architecture Principles

1. Golden path first, anything serving signup→delivery→webhook outranks everything else.
2. Postgres is the source of truth; Redis is acceleration, never record.
3. Async delivery always, no provider call in a request handler, no exceptions.
4. Providers behind interfaces (email, billing, hosted-verification).
5. Tenant isolation at the data-access layer, not just middleware.
6. Idempotency for every mutating operation where duplication causes harm.
7. Structured observability on every production-critical path.
8. Boring technology, strict TypeScript, small modules, no new dependency without justification.
9. No fake anything: no simulated metrics, no invented provider behavior, no badges unearned.

## Document Conflict Register

| # | Conflict | Resolution |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 | This directive §4 asks for "service-oriented / microservices architecture" evaluation. `ARCHITECTURE.md` §14 + ADR-007 (Accepted) mandate a **modular monolith** and require any new service to cite a split trigger. | **ARCHITECTURE.md wins.** Roadmap plans the modular monolith; § Service Boundaries lists split _candidates with triggers_, not services to build. |
| C2 | Directive §3 requires Google/GitHub OAuth. No doc currently specifies the identity method (`SECURITY.md` says only "standard, non-custom session/token mechanisms"). | No contradiction, OAuth _is_ the standard mechanism. Phase 2 implements it. Recommend appending OAuth provider choice to `SECURITY.md` §4 after Phase 2 (not before; avoid speculative spec). |
| C3 | Directive suggests phases for "Email Ingestion / Processing" as separate services. | Folded into API + worker deployables per C1. Documented as future split candidates only. |
| C4 | `docs/API.md` shows `calder_pk_test_…` publishable keys; implementation has `sk` only. | Open item, out of roadmap scope. Tracked for the API-keys task (Phase 3): either implement `pk` or correct `docs/API.md`. |

## Current-State Audit (what exists, graded)

| Area | State | Grade |
| ------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Monorepo, turbo, CI, docker-compose | Complete | Done |
| Drizzle schema (20 entities) + `0000_init.sql` | Complete, unapplied to prod (no prod DB) | Done, needs prod apply runbook (Phase 1) |
| API: health, emails, domains, projects, webhooks routes | Scaffold-grade, in-memory fallbacks present | Harden (Phase 1, 5) |
| Queue | `Queue<T>` interface + InMemory only | Replace backend (Phase 1) |
| Worker | Retry/backoff/DLQ logic, mock-or-SES provider | Durable state + live path (Phase 5) |
| Auth | API keys (gen/hash/verify/rotation shape) | Extend: OAuth, sessions, membership (Phase 2–3) |
| Billing | Interface + mock; Bachs unvalidated | Validate then integrate (Phase 8) |
| Rate limiting | In-memory | Redis backend (Phase 1) |
| Observability | Pino logs, request IDs | Metrics/alerts/status wiring (Phase 7) |
| Dashboard | Shell + overview/empty states | Complete per API (Phase 9) |
| Docs site | Marketing + 6 docs pages | Expand with SDKs/runbooks (Phase 10) |
| Tests | Unit (auth/queue/validation/rate-limit) | Add integration + path tests (every phase) |

## System Dependency Graph

```
Foundation (repo, CI, env, compose) [DONE]
 ↓
Prod-grade primitives (Redis queue/rate-limit, migration runbook)
 ↓
OAuth identity → sessions
 ↓
Organizations + memberships ──→ audit logs
 ↓
Projects + API keys + authorization ──→ dashboard shell binds here
 ↓
Domains + DNS verification + suppression
 ↓
Email send path hardening (SES live, durable DLQ, provider events)
 ↓
Webhook delivery engine
 ↓
Observability (metrics, alerts, status)
 ↓
Usage metering → Billing (Bachs validation first)
 ↓
Dashboard completion ←── depends on all above APIs
 ↓
Docs + SDKs ←── needs stable API surface (freeze before writing)
 ↓
Abuse controls + security review
 ↓
Load testing → scaling as evidenced
 ↓
Launch readiness → GA
```

Parallelizable off the critical path (after Foundation): brand/docs-site content,
SDK scaffolding against frozen types, dashboard shell work behind existing routes,
chaos/failure test design, runbook writing.

## Service Boundaries

No new services in MVP. Deployables stay: `apps/api`, `apps/worker`. Split
candidates with their triggers (per ARCHITECTURE.md §14, a PR proposing any of
these must cite the trigger):

| Candidate | Trigger that justifies the split |
| ---------------------------- | ------------------------------------------------------------------------- |
| providers → delivery service | Sustained SES throughput bottleneck or multi-provider failover need |
| billing → billing service | Reconciliation load or consistency needs diverge from request path |
| webhooks → delivery fleet | Webhook volume/latency SLOs diverge from send workers |
| OTP verifier | Sub-100ms verification SLO vs. minutes-tolerant sends (only if OTP ships) |

## Infrastructure Architecture

- **Dev:** `docker compose` (Postgres 16, Redis 7) + `pnpm dev`. Unchanged.
- **Staging:** mirror of prod at small scale; prod data never reachable from staging.
- **Prod:** Vercel for `web`/`dashboard` (via CLI); API + worker as containerized
 deployables on managed infra (provider TBD, record in `docs/DEPLOYMENT.md` when
 chosen); managed Postgres; managed Redis-compatible service.
- Migrations run via Drizzle CLI as a deploy step with rollback plan; never
 `db:push` against prod, never destructive sync.
- Secrets via environment + secret manager; never committed, logged, or client-exposed.
- Preview deployments for web surfaces; API/worker use staging, not previews.

## Authentication Architecture

External identity providers, never custom passwords. Supported: Google, GitHub
(directive §3; no doc contradicts this).

- OAuth 2.0 authorization-code flow with `state` validation; exact `redirect_uri`
 per environment registered at the provider console (documented, CLI-managed where possible).
- Session: opaque server-side session, `HttpOnly` + `Secure` + `SameSite=Lax` cookie.
 CSRF: SameSite + explicit token on mutations from dashboard.
- Account linking: same verified email across providers links to one user; new users
 get user + personal organization in one transaction (onboarding starts empty, not broken).
- Logout destroys server session; session expiry: 30d idle, absolute 90d (tune post-launch).
- Secrets: OAuth client IDs/secrets per environment via secret manager, never in repo.
- AuthN answers "who"; membership + project scoping answers "what allowed", enforced
 at data-access layer (existing `@calder/auth` authorization helpers extended, not replaced).

## Data Architecture

Implemented schema stands (20 entities). Phase work is additive + hardening:

- Add `oauth_accounts` (provider, provider_user_id, user_id, linked_at; unique per
 provider+id), `sessions` (id, user_id, expires_at, revoked_at, ip/ua hash, never raw PII).
- Indexing: existing tenant indexes stay; add `(project_id, created_at)` on
 `email_events` for timeline reads, `(organization_id, period_start)` already on usage.
- Constraints: keep FK cascades as defined; idempotency unique `(project_id, key)`.
- Retention: events 13 months, idempotency rows 24h TTL sweep (cron), audit logs
 immutable-from-UI (no update/delete path), soft-delete: organizations/projects only
 (`deleted_at`; emails/events never soft-deleted, immutable history).
- Migrations: additive only; any backfill ships with the migration + verification query.

## Caching Strategy

Redis-compatible store. Rule: cache accelerates, Postgres decides.

| Cached | TTL | Invalidated by | On cache failure |
| ----------------------------- | ------------- | ------------------------------- | ------------------------------------------ |
| API key → project/org context | 60s | revocation/rotation event | fall through to DB (slower, correct) |
| Domain verification state | 5 min | verification attempt/completion | re-check DNS (slower, correct) |
| Rate-limit counters | window length | n/a (ephemeral) | fail open for reads, fail closed for sends |
| Dashboard usage summaries | 60s | usage aggregation cron | query DB directly |
| Provider config | 5 min | admin change | read DB/env |

Every entry: TTL + explicit invalidation + DB fallback. No cache-aside writes that
can diverge; no billing-critical reads served from cache alone.

## Queue/Worker Strategy

- Backend: Redis-backed queue behind the existing `Queue<T>` interface (BullMQ-class
 semantics). InMemory stays for tests only; production import of InMemory is a bug.
- Queues: `email:send` (priority), `webhook:deliver`, `cron` (scheduled). Separate
 concurrency per queue; webhook retries never starve sends.
- Job lifecycle: active → completed/failed → retry (bounded, exp backoff + jitter) →
 dead-letter with reason/attempts/last-error/replayable flag.
- Transient vs permanent classification lives in one module (extended from
 `packages/queue/retry.ts`); provider adapters map their errors into it.
- Poison jobs: after max attempts → DLQ + alert; never infinite retry, never silent drop.
- Visibility: queue depth, oldest-job age, failure rate per queue, dashboard + alerts.
- Autoscaling: worker concurrency by queue depth (stage: manual config; autoscale policy in Scaling).

## Load Balancing Strategy

- MVP: platform-provided LB (Vercel edge for web; managed LB for API/worker containers).
 No self-managed LB, no service mesh. Sticky sessions not required (stateless API).
- API: health-gated rolling deploys; readiness fails on DB outage, liveness stays up
 (matches existing `/health` vs `/ready` semantics).
- Workers: drain-on-shutdown (finish active jobs, stop accepting); overlapping deploys
 must be idempotent-safe (they are, idempotency keys + job dedupe).
- Triggers for more: p95 enqueue latency >500ms sustained → horizontal API scale
 (Stage 2); queue oldest-age growth → worker scale (Stage 3).

## Observability Strategy

- Logs: structured JSON (pino), every line carries `request_id`; email/worker lines add
 `email_id`, `project_id`, `job_id`, provider response IDs. No secrets, no raw keys.
- Metrics: API latency/error rate, enqueue latency, queue depth + oldest age, worker
 failures, provider latency/errors, send/delivery/bounce/complaint rates, webhook
 failure/exhaustion rates, SES reputation signals.
- Alerts: queue oldest-age, worker failure spike, bounce/complaint rate thresholds,
 provider error spike, readiness failures. Alert on symptoms that page a human, not noise.
- Status: public page driven by the same health signals (no separate truth).
- Answering "what happened to my email": request_id → email timeline → events →
 webhook attempts, all correlatable from the dashboard.

## Security Progression

- **MVP:** key hashing + rotation, tenant-scoped queries, input validation (zod at
 boundaries), security headers, signed webhooks, secrets hygiene, CI dep scanning.
- **Production:** OAuth hardening review, session/CSRF audit, rate-limit tuning from
 real traffic, abuse controls (Phase 11), backup encryption, incident runbook drill.
- **Scale:** secret rotation policy, anomaly review cadence, pen-test before enterprise
 motion, audit-log immutability verification.
- **Enterprise (post-MVP):** SSO/SAML, roles, DPA flow, SOC 2 Type II pursuit.
- Never: secrets in logs, raw keys stored, stack traces to clients, second-source-of-truth caches.

## Billing/Usage Strategy

- Billable unit: one accepted send (`202` from `POST /v1/emails`). Webhooks, reads,
 retries, test-key traffic: never metered.
- Usage derived from durable `emails` + `email_events` rows via idempotent aggregation
 cron → `usage_records`. Redis counters inform dashboards only.
- Idempotent replay returns stored result without double-metering; provider retries
 don't double-count; permanent failures still count the accepted send (it was processed).
- Plans: free/starter/pro/scale, NGN+USD (per PRD). Hard limits, no overages in MVP.
- Provider: validate Bachs integration surface first (no fabricated endpoints, follow
 the existing abstraction discipline); Calder owns subscription state via webhooks.
- Dunning: past-due grace (7d) → sending paused, data retained; cancel anytime, export first.

## Development Phases

### Phase 0, Roadmap lock (this document)

Objective: agree on sequence, scope, and done-definitions before building.
Dependencies: all source docs (read). Tasks: write roadmap, self-critique (§
Self-Critique), lock MVP boundary. Deliverables: `docs/ROADMAP.md`; doc-update
list (C2: `SECURITY.md` §4 after Phase 2; C4: `docs/API.md` vs `sk`/`pk` in Phase 3).
Validation: team review; every phase has exit criteria. Exit: roadmap accepted, no
open sequencing disputes.

### Phase 1, Production-grade primitives

Objective: remove every scaffold fallback between the request path and reliability.
Dependencies: Phase 0. Tasks: Redis-backed `Queue<T>` implementation (keep
InMemory for tests; fail closed if prod resolves to it); Redis rate-limiter
backend; `db:migrate` production runbook + staging dry-run; enforce
`@calder/config` validation at startup (crash on invalid env); delete API/worker
in-memory email stores. Parallel: dashboard shell polish, docs-site content.
Deliverables: queue/rate-limit Redis adapters, migration runbook, no in-memory
fallback in prod paths. Testing: adapter unit tests, fallback-removal grep test,
staging migrate-dry-run. Validation: kill-Redis drill → API degrades per caching
table, sends fail closed with diagnosable errors. Risks: Redis provider choice;
keep client interface narrow so provider swap is config-only. Exit: prod deploy
uses Redis; `grep -r InMemory apps/` returns only tests.

### Phase 2, OAuth identity + sessions

Objective: Google/GitHub sign-in with secure sessions. Dependencies: Phase 1.
Tasks: OAuth flows + state validation + per-env redirect URIs; opaque sessions,
secure cookies, CSRF on dashboard mutations; account linking by verified email;
signup transaction (user + personal org); logout + expiry; add `oauth_accounts`,
`sessions` tables + migration. Parallel: org/project UI shells. Deliverables:
working login/logout in staging for both providers. Testing: OAuth callback tests
(state mismatch, existing-user, new-user), session expiry/revocation tests.
Validation: end-to-end login in staging; token/secret audit (nothing in logs/repo).
Risks: provider console config drift, record URIs + secrets locations in runbook.
Exit: login/logout/linking/expiry all green in staging; C2 doc update filed.

### Phase 3, Organizations, projects, keys, authorization

Objective: the tenant model enforced end-to-end. Dependencies: Phase 2. Tasks:
org CRUD + membership roles (owner/admin/member); project CRUD; API key lifecycle
(create-once secret, rotate, revoke, `pk`/`sk` decision per C4); extend
`@calder/auth` to session+key contexts; tenant-scope audit on every new query;
audit-log writes for membership/key/project events. Parallel: dashboard org/project
screens against these APIs. Deliverables: enforced multi-tenancy + audit trail.
Testing: cross-tenant access matrix (every resource × every role → 403/200),
revoked-key rejection, rotation continuity. Validation: red-team pass, one org
cannot read/modify/infer another's resources. Risks: missed query, mitigate with
the audit checklist in every PR. Exit: matrix green; audit log covers the
`SECURITY.md` §11 event list.

### Phase 4, Domains, verification, suppression

Objective: real sending identity. Dependencies: Phase 3. Tasks: domain CRUD;
DNS verification (TXT polling with backoff, failure reasons, expiry cleanup cron);
SPF/DKIM/DMARC guidance content; suppression list enforced pre-send with logged
reason; hosted-verification adapter interface only (Vercel first, MVP-adjacent,
no shipping until ADR-005 mechanism validated). Parallel: domain UI, deliverability
docs. Deliverables: verified-domain send path. Testing: verification state machine
tests, suppression-block tests (reason returned, event logged). Validation:
real DNS round-trip in staging; suppressed address returns `suppressed` error, not
silence. Risks: DNS propagation flakiness, Poll, don't assume; surface state honestly.
Exit: domain pending→verified→sending works; suppression blocks with reasons.

### Phase 5, Email pipeline hardening (SES live)

Objective: the golden send path, production-proven. Dependencies: Phase 4.
Tasks: SES credentials via secret manager; transient/permanent error mapping in
`SesEmailProvider`; durable DLQ state (DB-backed, replayable); provider event
ingestion (bounces/complaints → events + suppression); remove mock from prod path
(test keys still simulate). Parallel: log-viewer UI, provider runbook. Deliverables:
live SES sending with full event trail. Testing: path tests (API→DB→queue→worker→
mock-SES→events), failure injection (timeout, 4xx, 5xx), DLQ replay test.
Validation: send to seeded inboxes; bounce/complaint round-trip lands in events +
suppression. Risks: SES reputation, start sandboxed, warm gradually, enforce new-account
limits per `SECURITY.md` §7. Exit: §27-style checklist green (persisted, queued,
processed, sent, evented, idempotent, retried, diagnosable).

### Phase 6, Webhook delivery engine

Objective: events reliably reach customers. Dependencies: Phase 5. Tasks:
`webhook:deliver` queue consumer; HMAC signing; per-endpoint retry with backoff;
attempt history (`webhook_deliveries`); manual replay; endpoint secret rotation.
Parallel: webhook dashboard screens. Deliverables: auditable webhook pipeline.
Testing: signature verification tests, retry-then-succeed, exhaustion→visible,
replay-after-outage. Validation: kill test endpoint, recover, confirm redelivery
without duplicates (idempotent event IDs). Risks: retry storms, per-endpoint
backoff caps + circuit pause. Exit: delivery, failure, replay all visible in UI.

### Phase 6b, SMTP gateway + credentials (MVP)

Objective: beginners and SMTP-native stacks send through the same pipeline.
Dependencies: Phases 3 (projects/keys pattern to mirror), 4 (sender authorization),
5 (pipeline to converge into). Tasks: `smtp_credentials` table + migration (hash,
rotation, revocation, last-used); `apps/smtp-gateway` (AUTH PLAIN/LOGIN, STARTTLS,
MIME→Email normalization, sender-auth + suppression checks, shared enqueue);
TCP-LB pass-through + cert runbook; dashboard SMTP setup UI (host/port/user/secret,
rotation, Nodemailer/smtplib copy-paste); `docs/SMTP.md` + site quickstart.
Gmail Quickstart track (same phase): Connect OAuth flow (dashboard routes +
callback), credential CRUD endpoints, transport picker in onboarding
("Connect Gmail" vs "Add a domain"), graduation prompts at cap approach,
`smtp.calder.click` vs Gmail-path docs split. Transport backend
(`project_transports`, `EmailTransport`, `GmailTransport`, worker routing) is
built, remaining is connect UI + live Google testing (needs Cloud console setup).
Parallel: abuse-monitor tuning, migration guide from Gmail-SMTP DIY. Deliverables:
working `smtp.calder.click:587` in staging. Testing: protocol tests (incl.
open-relay attempts, plaintext-AUTH rejection), auth/rotation/revocation tests,
TLS tests, Nodemailer + smtplib + PHPMailer interop tests, failure tests.
Validation: send via three real clients; revoke mid-flight; leak drill. Risks:
abuse magnet, gate staging behind invite; connection-exhaustion, caps from day
one. Exit: §35-style definition of done green (auth, TLS, no relay, pipeline
convergence, events, metering, logs, limits, docs, scale plan).

### Phase 7, Observability, metrics, status

Objective: answer "what happened to my email" in seconds. Dependencies: Phase 6.
Tasks: metrics emission (queue depth/age, provider latency, delivery/bounce rates);
alert rules + routing; public status driven by health signals; log retention policy;
dashboard observability views (timeline, request search). Parallel: runbook writing.
Deliverables: dashboards, alerts, live status page. Testing: alert fire-drill
(synthetic failure pages correctly); retention cron test. Validation: staged
incident, detect via alert, diagnose via timeline, post to status. Risks: alert
fatigue, start with 5 paging alerts max. Exit: the five alerts exist and have fired
in drill; status reflects staged failure.

### Phase 8, Usage metering + billing

Objective: trustworthy money. Dependencies: Phase 7 (events durable). Tasks:
**first validate Bachs surface** (real endpoints/SDK/webhook shapes, no fabrication);
aggregation cron (durable rows → `usage_records`, idempotent reruns); quota
enforcement (hard limits, clear errors); subscription lifecycle via provider
webhooks (Calder owns state); dunning (7d grace → pause); NGN+USD plans/prices
seed. Parallel: billing UI against mocked service. Deliverables: metered, gated,
billed. Testing: aggregation idempotency, replay-no-double-meter, dispute drill
(invoice vs dashboard vs raw rows, must match). Validation: euro... dollar and
naira test charges end-to-end in sandbox. Risks: provider detail gaps, timebox
validation; if Bachs can't serve, re-evaluate provider before building further.
Exit: metered usage reconciles to the email; paid plan gates sending.

### Phase 9, Dashboard completion

Objective: every API capability operable in UI. Dependencies: Phases 3–8 (build
screens only against shipped APIs, no screen before its endpoint). Tasks:
onboarding (org→project→key→domain→first send), projects, keys, domains,
logs/timeline, webhooks, usage, billing/settings, organization. Parallel: none,
this phase trails the APIs by design. Deliverables: complete customer app.
Testing: route-guard tests (server enforcement, not just UI hiding), empty/loading/
error states per view. Validation: golden path clickable end-to-end by a stranger
in staging. Risks: building ahead of APIs, enforce the dependency rule in review.
Exit: stranger test passes; every mutating view has loading/error/empty states.

### Phase 10, Docs + SDKs

Objective: time-to-first-delivery under five minutes, self-serve. Dependencies:
stable API (freeze v1 surface first, no SDK against a moving target). Tasks:
docs IA (install→auth→keys→first email→domains→events→webhooks→SDKs→
troubleshooting→production); TypeScript SDK first (highest value ecosystem);
Python next; API reference generated from zod schemas where possible. Parallel:
changelog habit, migration guide from Resend. Deliverables: docs site + 2 SDKs.
Testing: snippet tests (every code sample runs in CI); SDK integration tests.
Validation: stranger-to-delivery timed test. Risks: docs drift, generate from
schemas/types, test samples in CI. Exit: 5-minute stranger test passes twice.

### Phase 11, Abuse prevention + security review

Objective: survive contact with adversaries and the SES reputation gods.
Dependencies: Phase 10 (real traffic patterns visible). Tasks: rate-limit tuning
from data; bounce/complaint monitoring + auto-throttle; new-account sending ladder
(verify → limited → full); suspension + appeal flow; key revocation at scale;
full security review against `SECURITY.md` (authn/z, isolation, secrets, headers,
deps); backup-restore drill. Parallel: incident runbook finalization. Deliverables:
abuse controls + reviewed posture. Testing: abuse simulations (spam burst, bounce
bomb), suspension flow, restore-from-backup drill. Validation: simulated attack
contained without manual heroics. Risks: false positives, start in monitor mode,
enforce after tuning. Exit: review signed off; restore drill succeeded (tested,
per `SECURITY.md` §13, not just configured).

### Phase 12, Load testing + evidenced scaling

Objective: know the ceiling before users find it. Dependencies: Phase 11.
Tasks: load harness (send throughput, webhook fan-out); find first bottleneck;
apply Stage 2/3 scaling only where evidenced; SES limit increases with reputation
data. Parallel: capacity runbook. Deliverables: measured limits + headroom.
Testing: sustained-load soak, burst test, provider-outage simulation. Validation:
2× current peak sustained cleanly; failure modes observed, documented, handled.
Risks: load-testing SES reputation, use sandbox/seeded traffic, never prod reputation.
Exit: documented capacity + next-bottleneck forecast.

### Phase 13, Launch readiness + GA

Objective: open the doors without heroics. Dependencies: Phase 12. Tasks: launch
checklist (§ Launch Readiness) top to bottom; final pricing lock; status/changelog
habits live; support triage staffed; rollback rehearsed. Deliverables: GA.
Validation: checklist 100%, stranger test, rollback drill. Risks: launch-day
surprises, mitigated by everything above. Exit: GA declared, first real revenue.

## MVP Boundary

**MVP = Phases 0–10 + 13 (launch), including 6b (SMTP gateway), with 11–12 compressed to essentials.**
Concretely: golden path in production, OAuth login, projects/keys/domains, live SES,
webhooks, usage+billing (sandbox-validated), completed dashboard, docs + TS SDK,
baseline abuse ladder, measured smoke capacity. Deferred to post-MVP: Python SDK,
advanced analytics, scheduled/batch sending, hosted-domain verification shipping,
OTP decision, multi-provider failover, enterprise controls.

## Post-MVP Roadmap

1. Templates (versions, variables, previews), unlocks the editor story.
2. OTP decision (ADR-006): in-MVP-or-next, with attempt limits + audit.
3. Hosted-domain verification shipping (ADR-005 mechanism validation first).
4. Batch/scheduled sending + suppression-management UI.
5. Second provider + failover (only after SES path is boring).
6. Analytics depth, second SDK wave (Go, PHP), SSO/roles, regional presence.
7. Campaign architecture (audiences, contacts, consent/unsubscribe, scheduling,
 batching, campaign analytics), designed as separate tables/pools from day
 one of the design, never bolted onto transactional sends. No bulk mail
 through Gmail, ever; campaigns require verified domains + managed transport.
8. Developer surfaces: CLI (`calder doctor` diagnostics first), MCP server,
 migration assistant (mapping guides + codemod, guides, never API cloning),
 template playground, Email Debugger trace view + "why didn't it arrive"
 explainer, inbound email (user → Calder → app webhook).
9. One-time purchases: credits ledger + email packs + domain slots (see
 `docs/PRICING.md`), built with billing, prepaid-first for card-scarce markets.

## Scaling Roadmap

- **Stage 1 (now):** single prod deploy, strong boundaries. Trigger baseline: everything.
- **Stage 2:** horizontal API when p95 enqueue >500ms sustained. Change: replicas + LB. Risk: session statelessness (already stateless). Migrate: rolling.
- **Stage 3:** worker scale on queue-oldest-age. Change: per-queue concurrency/autoscale. Risk: provider throttle, coordinate SES limits first.
- **Stage 4:** DB read scaling when slow-query log implicates reads. Change: read replica for dashboards/logs. Risk: replica lag in timelines, pin timeline reads to primary.
- **Stage 5:** queue/provider scaling + failover (post-MVP trigger only).
- **Stage 6+:** regional, only on evidence (latency SLO breach by region).

## Technical Debt Strategy

Debt is logged in `docs/DECISIONS.md` (ADR-style) at creation time, tagged
`debt:`, with owner + revisit phase. Rule: each phase closes more debt than it
opens; launch requires zero `debt:launch-blocker` items. Known Day-1 entries:
in-memory fallbacks (Phase 1), mock billing (Phase 8), `pk` key decision (Phase 3).

## Launch Readiness Checklist

- [ ] Golden path stranger-tested in staging and prod
- [ ] SES production access + warmed reputation plan active
- [ ] Backups tested by restore (not configured)
- [ ] Rollback rehearsed for API, worker, and migrations
- [ ] 5 paging alerts live and drill-fired; status page truthful
- [ ] Abuse ladder on; suspension/appeal flow tested
- [ ] Pricing locked; dunning tested; support staffed
- [ ] Docs complete through production guide; SDK snippets CI-tested
- [ ] Security review signed; secrets rotated into prod manager
- [ ] Zero launch-blocker debt; incident runbook printed (figuratively)

## AI Agent Execution Strategy

Work is issued per phase-task with: context (docs to read), objective, affected
files/packages, dependencies, implementation requirements, tests, validation
commands (`pnpm typecheck/lint/test/build`, targeted vitest), and definition of done.
One logical change per PR from `feat/...` via `gh`; no direct `main` commits; no
merging own PRs. Agents must stop on any conflict with AGENTS/PRD/ARCHITECTURE/
SECURITY and report it, never improvise architecture, endpoints, or provider behavior.

## Recommended Implementation Order

Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13, with docs-shell,
dashboard-shell, and SDK-type work parallelized where dependency-free (see graph).

## Immediate Next 10 Engineering Tasks

1. Redis queue backend + prod-guard against InMemory (Phase 1).
2. Redis rate-limiter backend (Phase 1).
3. Production migration runbook + staging dry-run (Phase 1).
4. Startup env-validation enforcement + remove in-memory email stores (Phase 1).
5. OAuth spike: Google provider console setup + callback skeleton (Phase 2).
6. `oauth_accounts` + `sessions` migration (Phase 2).
7. Session middleware + dashboard auth boundary (Phase 2).
8. Cross-tenant audit of all existing queries (Phase 3 prep).
9. `pk` vs `sk`-only decision + `docs/API.md` alignment (C4).
10. SES sandbox warm-up plan + reputation monitoring baseline (Phase 5 prep).

## Self-Critique (mandated by directive §36)

1. **Missing dependencies:** queue visibility UI assumed in Phase 7 but DLQ replay UI needed in Phase 5, corrected: DLQ replay ships in Phase 5, polish in 7.
2. **Incorrect sequencing:** billing UI was parallelizable but aggregation cron wasn't, clarified in Phase 8.
3. **Overengineering:** removed any Kubernetes/service-mesh/OTP-service language; OTP stays a table + endpoints unless SLO trigger fires.
4. **Security gaps:** added backup-restore drill and rotation policy explicitly (were implied).
5. **Scaling risks:** SES sandbox-to-prod transition called out in Phase 5, not left to launch.
6. **Reliability risks:** worker drain-on-shutdown added to LB strategy.
7. **Database risks:** replica-lag caveat added to Stage 4; soft-delete scoped (orgs/projects only).
8. **Authentication risks:** provider-console drift recorded as runbook item.
9. **Billing/usage risks:** Bachs validation timeboxed with re-evaluation gate.
10. **Operational risks:** alert-fatigue cap (5 paging alerts) added.

## Final Corrections Applied

- DLQ replay UI moved to Phase 5 deliverables.
- Stage 4 replica-lag caveat added.
- Backup-restore drill + rotation policy made explicit exit items (Phases 11, 13).
- C1–C4 conflict register added; no microservices planned; OAuth filed as non-conflicting.
- `docs/API.md` `pk` discrepancy assigned to Phase 3 instead of lingering.

_End of roadmap v1._
