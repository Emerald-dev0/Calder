# Architecture & Product Decisions

Record any decision that (a) reverses something already built, or (b) a reasonable engineer or AI agent might later be tempted to "fix." Skip obvious/easily-reversible decisions.

---

## ADR-001: PostgreSQL is the source of truth

**Status:** Accepted
**Decision:** PostgreSQL is Calder's single authoritative datastore.
**Why:** relational consistency, transactional support, fits multi-tenant + billing + event data.
**Alternatives considered:** MongoDB, DynamoDB, rejected for weaker consistency guarantees.

---

## ADR-002: Email delivery is asynchronous

**Status:** Accepted
**Decision:** API requests enqueue a send job rather than calling the provider synchronously.
**Why:** predictable latency, retryability, provider outages don't block API responses.

---

## ADR-003: Every external provider sits behind an interface

**Status:** Accepted
**Decision:** Email (SES), payments (Bachs), hosted-domain verification (Vercel) are only accessed via internal adapters.
**Why:** enables migration/failover/testing without vendor lock-in.

---

## ADR-004: Agent rules live in AGENTS.md, not a separate Rules.md

**Status:** Accepted
**Why:** multiple rule files drift and contradict; one file is worth the length.

---

## ADR-005: Hosted-domain verification proves project ownership, not sending authorization

**Status:** Open problem
**Context:** verifying `*.vercel.app` project control doesn't satisfy SPF/DKIM/DMARC on a zone the developer doesn't own.
**Options:** send via an Calder-managed subdomain mapped to the verified project; investigate Vercel DNS delegation; restrict to informational verification until a mechanism is validated.
**Must be resolved with a working prototype before shipping past MVP-adjacent status.**

---

## ADR-006: OTP MVP inclusion, undecided

**Status:** Open
**Decision:** deferred, revisit after the core email golden path works end-to-end.

---

## ADR-007: Modular monolith over microservices at launch

**Status:** Accepted
**Decision:** one API deployable, one worker deployable, shared packages with enforced boundaries, not independently deployed services.
**Why:** no current team/scale/reliability pressure justifies the operational cost. Package boundaries are kept clean so a future split doesn't require a rewrite, see `ARCHITECTURE.md` §14 for concrete split triggers.
**Alternatives considered:** microservices from day one, rejected per PRD as premature complexity.

---

## ADR-008: Editorial Infrastructure as the locked design direction

**Status:** Accepted
**Decision:** Calder's visual identity sits between Linear/Stripe-style technical precision and high-end editorial/Awwwards-level art direction, never a generic purple-gradient SaaS look.
**Why:** design is treated as a differentiator (per PRD §13), not decoration; a distinctive visual identity is one of Calder's few defensible moats against feature-parity competitors.
**Enforcement:** `docs/DESIGN.md` is authoritative; any UI PR requires the visual QA loop in `AGENTS.md` (render → screenshot → self-review against the checklist → iterate → attach evidence) before merge, specifically to catch cases where a color or layout is technically correct but reads wrong once actually rendered.

---

## ADR-009: Lenis for smooth scroll

**Status:** Accepted
**Decision:** Lenis powers scroll behavior on `apps/web`, used more conservatively on `apps/dashboard`.
**Why:** scroll-driven storytelling is core to the homepage's "invisible infrastructure made visible" concept (`docs/DESIGN.md` §7); Lenis is a well-established, lightweight option for this rather than building custom scroll physics.
**Constraint:** must degrade cleanly under `prefers-reduced-motion` and must not regress core web vitals (see `docs/DEPLOYMENT.md` performance targets), this is a hard constraint, not a nice-to-have.

---

## ADR-010: CLI-first over dashboard-first tooling

**Status:** Accepted
**Decision:** Prefer `gh` (GitHub CLI), `vercel` CLI, and equivalent CLIs for any tool that has one, over manual web-dashboard operations.
**Why:** scriptable, diffable, reproducible, and auditable in PR history, particularly important once AI agents are doing meaningful portions of the operational work, since dashboard clicks leave no reviewable trace.
**Scope:** applies to repo/PR management, deployments, environment variable management, and database migrations at minimum; extend to other tools (Bachs, etc.) as CLIs become available.

---

## ADR-011: Scaffold queue is in-memory with a drop-in Redis path

**Status:** Accepted
**Decision:** `packages/queue` ships an `InMemoryQueue` behind the `Queue<T>` interface; a Redis-backed implementation replaces it without changing API/worker code.
**Why:** unblocks the API → queue → worker → provider vertical slice locally with zero infra; the interface (enqueue/enqueueDelayed/process/close/drain) is the contract, not the backend.
**Constraint:** InMemory must never be used in production, multi-instance deployments would lose jobs. `getRateLimiter` has the same rule.

---

## ADR-012: ESLint 8 (not 9) for the scaffold

**Status:** Accepted
**Decision:** pin `eslint@8` with `.eslintrc.cjs` until the repo migrates to flat config deliberately.
**Why:** ESLint 9 drops `.eslintrc` and `--ext`; adopting flat config is a separate, deliberate migration, not scaffold fallout.

---

## ADR-013: API-key hashing is SHA-256 + pepper, not bcrypt

**Status:** Accepted
**Decision:** API keys are verified via SHA-256 hex with constant-time comparison (`timingSafeEqual`).
**Why:** keys are checked on every API request, bcrypt's cost would add unacceptable per-request latency. Entropy comes from 24 random bytes + optional `API_KEY_PEPPER`, not from a slow hash.

---

## ADR-014: SMTP gateway as a separate deployable converging on one pipeline

**Status:** Accepted (topology: gateway process TBD, see open points)
**Decisions:**

1. Calder supports SMTP alongside REST because beginners and existing stacks
   (WordPress, Laravel, Django, Nodemailer/smtplib users) already speak it,
   meeting them at their protocol beats teaching an abstraction. No invented
   SMTP extensions; standard AUTH/STARTTLS/MAIL/RCPT/DATA/MIME only.
2. SMTP and REST converge after ingestion into one email model, one queue, one
   worker fleet, one event lifecycle, one usage meter. Two delivery systems are
   banned by design, not just by review.
3. Credentials are project-scoped (never account-global), shown once, hashed at
   rest, unlike the industry default of reusing one API key as the SMTP password.
4. The gateway is its own deployable (`apps/smtp-gateway`), sharing queue/pipeline
   packages. Justification under ADR-007: long-lived TCP connections vs short HTTP
   requests (different scaling/failure profile), an abuse-sensitive public ingress
   (different security boundary), and protocol-specific deploy risk. All three map
   to accepted split triggers, this is not "felt cleaner."
5. Load balancing is TCP pass-through (HAProxy/NLB-class, least-conn, health
   checks); TLS terminates at the gateway, never the LB, validated against
   industry practice (STARTTLS lives inside the TCP session; terminating it
   upstream complicates the protocol and the audit trail).
   **Why:** SMTP is the migration path and the beginner path; one pipeline keeps
   billing, events, and guarantees coherent across interfaces.
   **Open (must validate before GA):** managed TCP-LB provider choice; cert rotation
   mechanism; attachment size caps; `X-Calder-*` extension header set.

---

## ADR-015: Dashboard reads via server components + tenant helper

**Status:** Accepted
**Decision:** Dashboard pages query Postgres directly in Server Components
through `getTenantContext()`, instead of HTTP calls to our own API.
**Why:** server components execute on the server (BFF pattern, not client DB
access); an HTTP hop would add latency plus a second auth mechanism with no
isolation gain. Enforcement lives in the helper (seal + expiry + revocation +
project scoping), and middleware is documented as presence-check only.
**Constraint:** every new dashboard query must go through the helper,
raw `getDb()` in a page without tenant scoping is a bug.

---

## ADR-016: Avenor → Calder rebrand with compat shims

**Status:** Accepted
**Decision:** Full rename (packages `@calder/*`, display, metadata, examples,
`calder_sk_` issuance, `calder_verify_` tokens, `calder_*` cookies). Preserved:
`org_avenor`/`proj_website` seed IDs (persisted, invisible), `avenor_sk_` key
verification (hashing is prefix-agnostic, old keys work forever),
`avenor_verify_` DNS acceptance, old migrations byte-identical. Board-approved
mark system adopted as canonical; prior exploration retained as process history.
Accent Blue `#3D5AFE` adopted as `signal` token; `#1E3A8A` stays for light-surface interaction.
**Why:** a name change must never break a customer, a migration chain, or a
verified domain. Compat costs nothing here, so we pay it everywhere.

---

## ADR-017: Transport abstraction with per-project defaults

**Status:** Accepted
**Decision:** `EmailTransport extends EmailProvider` (+ capabilities, health);
worker resolves each job's transport via pure `pickDefaultTransport()`,
active default wins, suspended/revoked fail closed, absent falls back to global
SES/mock. Graduation is a row update, never a reintegration.
**Why:** beginners (Gmail) and production (SES/managed) share one pipeline,
one event model, one meter. Alternatives (per-transport pipelines, provider
branching in handlers) were rejected as the two-systems trap.

---

## ADR-018: Gmail via OAuth, minimum scope, encrypted tokens

**Status:** Accepted
**Decision:** Gmail Quickstart uses Google OAuth with `openid + email +
gmail.send` only, never passwords. Refresh tokens AES-256-GCM encrypted
(context-separated), decrypted in-memory at send time. Conservative caps
(400/day default) enforced pre-send; revocation (ours or Google's) surfaces as
explicit permanent errors. No bulk mail through Gmail, by design and by cap.
**Why:** the beginner funnel (no domain, no budget) without becoming a spam
relay or a credential honeypot. Requires Google Cloud OAuth consent setup
(external config, see report).

---

## ADR-019: NGN-first pricing hypothesis, gated by unit economics

**Status:** Proposed (hypothesis, not promise)
**Decision:** Free ₦0/3k; Builder ≈₦3, 500/25k; Pro ≈₦7, 500/75k; Scale
≈₦20, 000/250k. NGN leads, USD equivalents set at launch parity review. No value
hardcoded outside plan-configuration tables. Nothing ships commercially until
`docs/PRICING.md` unit-economics model clears.
**Why:** Nigeria-first accessibility without fake precision, FX volatility makes
premature dollar figures dishonest, and hardcoded prices become lies at scale.

---

## ADR-020: One-time purchases via credits ledger; no API cloning for migration

**Status:** Accepted (specified; build with billing)
**Decisions:**

1. Prepaid email packs + add-ons are funded through a `credit_ledger` consumed
   by the same aggregation cron as subscriptions, one meter, two funding
   sources, auditable, never negative.
2. Migration tooling is mapping guides + codemods, never API-compatible
   emulation of a competitor's SDK. Guides lower switching cost without legal
   exposure; cloning a proprietary API surface invites it.
3. Queued-but-unsent emails are cancellable (remove from queue + `canceled`
   status + event), the only honest scope of "cancellation." Once accepted by
   a provider, mail cannot be un-sent, and we say so.
   **Why:** card-scarce markets need non-subscription revenue; trust-first
   migration beats compatibility-theater migration.

## ADR-021: Magic-link auth mail sends synchronously (queue exception)

**Status:** Accepted
**Decision:** The magic-link request route sends its one email via the provider
abstraction inline instead of the job queue. Tokens are 256-bit random,
sha256-hashed at rest, single-use, 15-minute expiry, rate-limited 5/min per
IP and per email, no account enumeration.
**Why:** login must not depend on worker liveness; one transactional email is
the same latency class as the OAuth code exchange. Bulk and tenant mail stay
on the queue per ADR-002.

## ADR-021b: Canonical brand mark (brand sprawl fix)

**Status:** Accepted
**Decision:** The canonical Calder mark is the dot + signal-A geometry
(110x80) already rendered in production UI, now shared as `CalderLockup` /
`CalderMark` in `@calder/ui`. Stale `avenor-*` assets stay on disk untouched;
the emailed `logo.svg` was regenerated to the canonical geometry (it also
still said "Avenor" in its accessible label). No new mark may be introduced
without updating the shared component first.

## ADR-023: SES production access (50k/day, 14/s, out of sandbox)

**Status:** Accepted (live 2026-09-13, case 178897239300386, `us-east-1`)

**Decision:** Production SES quota verified (`50,000/day, 14 msgs/s, sandbox removed`). Worker host must have `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` + `AWS_REGION=us-east-1` to send via SES; missing creds fall back to Mock (test keys never hit SES). Bulk and transactional mail now share the prod provider with the sender-aware chain (ADR-017 + Phase 9 failover).

## ADR-022: Password auth with scrypt + email OTP verification

**Status:** Accepted
**Decision:** Manual signup/sign-in is email + password (scrypt N=16384/r=8/p=1,
per-user salt, timing-safe compare, dummy-hash fallback so unknown emails and
wrong passwords are timing-indistinguishable), gated by a 6-digit email code:
signup verifies before first session, login with an unverified account drops
to the code step, resets burn the old password. Codes are sha256-hashed at
rest, single-use, 10-minute expiry, 5 attempts max. Platform codes live in
`email_code_challenges`, never in tenant `otp_challenges`.
**Why:** market parity, every competitor offers a manual path and we were
OAuth-only. Passwords over magic-links alone because users asked for
Resend-style email + password; OTP instead of mailed reset links because
receipt already proves ownership and there is nothing phishable to click
later. Hashes never logged, never returned, reset marks the address
verified.

## ADR-024: Pricing architecture locked: capability ladder, two local prices, marketing included

**Status:** Accepted (2026-09-14, public launch)
**Decision:** Four plans, Beginner $0/₦0 (5,000 emails, 3 projects, 2 domains,
development environment), Pro $15/₦25,000 (50,000, dev+staging+production),
Premium $49/₦75,000 (250,000, deliverability + security + 90-day logs),
Scale custom (dedicated capacity, SLA, SSO). ₦ and $ are separate price points,
never an FX conversion. Marketing allowances are counted in contacts and are
included in every plan, including Beginner.
**Why:** the previous ₦10k/₦25k/₦60k hypothesis ladder was a volume ladder, which
made Calder look like a Resend clone at every tier. The distinction that matters
to a buyer is capability (build → ship → operate → depend), not the number of
zeros. Priced-in-naira-because-you-are-in-Nigeria is a real advantage only if the
naira price is a decision rather than a conversion. Including the marketing suite
below the paid line removes the transactional/marketing bundling decision from
the buyer's plate while the separate-streams architecture keeps their reputation
intact.
**Consequence:** `apps/web/lib/plans.ts` is the single public source of truth;
the pricing page, comparison tables, FAQ and structured data all read from it.
`docs/PRICING.md` §4's unit-economics gate still applies to any change.

## ADR-025: Marketing becomes a first-class stream, not a feature flag

**Status:** Accepted (direction), marketing suite **in development**
**Decision:** Calder is not a transactional-only platform. Transactional
(immediate, application-triggered) and marketing (scheduled, list-targeted) are
two streams on one pipeline: separate suppression, separate consent, separate
rate limits and separate allowance, sharing the API, event log, webhooks and
quota meter. Public surfaces describe the marketing suite as "in development"
until it ships; the label lives in `apps/web/lib/site.ts` and is removed in the
shipping commit.
**Why:** the original PRD said "not targeting: newsletter platforms, marketing
automation". That stance is wrong for the market Calder actually sells into:
Nigerian and African teams overwhelmingly want both, and buying them from two
vendors means two reputations, two suppression lists and two bills. Making them
one platform with two streams is the differentiator, and it is only defensible
because the streams never share reputation.
**Consequence:** PRD §3/§18 updated; campaigns remain post-MVP in scope, so the
architecture is not re-opened, only the product direction.

## ADR-026: The sending path fails loudly, never silently simulates

**Status:** Accepted (2026-09-14)
**Decision:** `resolveEmailProvider()` in `@calder/providers` is the only place
a mail provider is chosen. In production, missing AWS credentials throw
`EmailProviderNotConfiguredError` instead of falling back to the mock provider.
In development the mock is correct behaviour and is logged with its reason.
`/ready` performs real checks (database query, Redis PING, provider
deliverability) and reports `degraded` with a 503 rather than claiming `ok`.
`pnpm launch-check` verifies the whole confirmation-email path: provider
credentials, SES sandbox status, internal tenant seed, dynamic waitlist template,
queue durability, secrets and origin allowlist.
**Why:** every auth email path (signup verification, magic link, waitlist
confirmation) previously resolved `AWS_ACCESS_KEY_ID ? SES : Mock` inline, so a
production deploy without credentials accepted requests, stamped 200s, and
delivered nothing, indistinguishable from a deliverability problem. That is the
worst possible failure for a launch: silent, and discovered by users.
**Consequence:** provider selection is uniform across API, worker, cron and
dashboard auth routes; a genuinely unconfigured production deploy fails on the
first send attempt instead of pretending.

## ADR-027: Founder/Admin Control Plane (separate layer, one login)

**Status:** Accepted (built 2026-09-14, verified live)
**Decision:** The operational admin surface lives under `/control` in the
dashboard app as a distinct layer with its own design system (dark, dense,
operator-grade) and its own section gate, sharing identity and data with the
customer dashboard. Access is by platform role (`users.platform_role` +
section map in `lib/control/gate.ts`). The only founder bootstrap is the
`FOUNDER_EMAILS` env allowlist, applied at session creation; precedence (DB
founder role > env bootstrap > non-founder DB role > customer) is locked by
unit tests. Nobody can self-promote: role grants are founder-only, reason-
required, and audit-logged. The founder remains a normal customer (owns the
"Calder" org) — platform role never alters tenant behavior.
**Why:** the founder needs one screen that answers "is the business OK,
are customers OK, is Calder healthy, is anything broken?" without touching
the customer product, and every internal action needs an audit trail
(`audit_logs`, before/after metadata). A separate app would duplicate auth
and the data layer for zero benefit at this scale; a subdomain move later is
a deploy concern, not a code concern.

## ADR-028: Control Plane metrics and alerts evaluate live; no snapshot state

**Status:** Accepted
**Decision:** Command Center stats and the alert rule book are pure functions
over current database/Redis state, evaluated per request
(`lib/control/stats.ts`, `lib/control/alerts.ts`, unit-tested). There are no
metric snapshot tables and no alert-state store in V1; alert history begins
with the notifications/incidents work.
**Why:** the demo dataset taught the lesson early — a stored "oldest queued
job" stat went stale while the underlying queue state moved, and the alert
fired with a 47-day-old value. Live evaluation cannot silently lie. If
per-request cost ever matters, we add materialized rollups behind the same
functions, not a parallel truth.

## ADR-029: Vercel Node functions must use the fetch-object shape

**Status:** Accepted (2026-09-15, after a production 100% error-rate incident)
**Decision:** `apps/api/src/serverless.ts` default-exports `{ fetch(request) }`,
never a bare `(req: Request) => Response` function. The Vercel Node runtime
only supports the fetch-object shape, named `GET`/`POST`/… exports, or a
classic Node `(req, res)` handler; a bare fetch-style function is invoked with
Node `IncomingMessage`/`ServerResponse`, throws on every request, and reads as
a generic `FUNCTION_INVOCATION_FAILED` with no hint of the contract mismatch.
**Why:** the esbuild bundle was proven working under plain Node while
production 500'd every invocation — the code was correct and the export shape
was not. A passing build and a green deploy badge say nothing about this;
only a real `/health` 200 on the deployed URL counts.

## ADR-030: Workspace packages ship compiled dist, not TS sources

**Status:** Accepted (2026-09-15, production served the raw `src/` tree)
**Decision:** every `packages/*` builds real JS into `dist/` (`tsc` emit,
`noEmit: false`) and `main`/`exports` point at `dist`, never `src/*.ts`.
Relative imports use explicit `.js` suffixes (Node ESM style); the one JSON
import uses `with { type: "json" }`.
**Why:** Vercel's Hono handling transpiles `apps/api/src` per-file and
executes it under plain Node, so every bare `@calder/*` import must resolve
to runnable JS. `exports: ./src/*.ts` only ever worked under `tsx`. tsx,
vitest, and Next all resolve the dist + `.js`-suffix form fine, so one layout
serves dev, CI, Docker, and Vercel.
**Constraint:** dev (`tsx`) now resolves `@calder/*` to `dist`, so rebuild
packages after changing them (`pnpm build`); `turbo test`/`typecheck` already
order `^build` first. Never point `exports` back at `src/*.ts`.

## ADR-031: Control Plane light register, first-party analytics, confirmation email versioning

**Status:** Accepted (2026-09-15, founder directive on CR-001)
**Decision:** (1) The Control Plane adopts the light Paper register
(#F5F4EF surface, Ink text, cobalt as signal-only accent) per the founder's
redesign specification, superseding the dark register chosen in ADR-027.
The "separate layer with its own design system" principle stands — only the
register changes: `control.css` tokens flipped, class structure preserved.
(2) Growth analytics gain a first-party event layer: `analytics_events`
(anonymous visitor/session ids, paths, CTA labels, edge-derived country —
no PII columns by construction), a rate-limited public `POST /v1/beacon`,
and a collector on the marketing site. Traffic metrics render explicit
empty states until data accrues; nothing is fabricated.
(3) The waitlist confirmation email is versioned: a draft table plus
immutable published versions materialize into the existing
`waitlist_confirmation` row, so the API send path is untouched; send-test
mail is subject-prefixed `[TEST]` and never touches signups or analytics.
**Why:** the founder command-center spec requires the light editorial
register and real visitor/CTA/geography analytics; overwriting the
confirmation email in place destroyed history and made testing impossible
without polluting the funnel.

## ADR-032: Idempotency claims are atomic, claim-first, replay-on-conflict

**Status:** Accepted (2026-09-19, Phase 0 / M0.1)
**Decision:** A send carrying an `Idempotency-Key` inserts the claim row
FIRST, inside the same transaction as the `emails` + `email_events` rows
(`INSERT ... ON CONFLICT (project_id, key) DO UPDATE ... WHERE
expires_at < now() RETURNING`). A concurrent same-key request waits on the
conflict until the winner commits, then replays the stored response (`200`,
same id) instead of inserting a second row; a key whose winner is still in
flight returns `409 idempotency_conflict`; an expired claim (24h) is
atomically refreshed and re-claimed. A persist failure in production is a
500, never a pretend-202 (the dev-only in-memory fallback is unchanged).
**Why:** the old lookup-then-insert race let N concurrent same-key requests
persist N rows and double-send, violating the API contract. The unique
indexes on `idempotency_keys(project_id, key)` and `emails(project_id,
idempotency_key)` become the enforcement mechanism instead of a crash source.
**Do not:** reintroduce a pre-check SELECT as the concurrency mechanism (it
can only ever be a fast-path; the claim transaction is the authority), or
return 202 before the row is durable.

## ADR-033: Webhook signing secrets are shown once, single encryption scheme

**Status:** Accepted (2026-09-19, Phase 0 / M0.3)
**Decision:** `POST /v1/webhooks` (and the dashboard manager) generate
`whsec_<48hex>`, return it in the create response EXACTLY ONCE, and store
only `@calder/auth` AES-256-GCM envelope ciphertext under the
`webhook_signing` context. Both surfaces share that one scheme so the
delivery engine (Phase 3) decrypts against a single contract. `GET
/v1/webhooks` never returns secret material (raw or ciphertext). There is
no read-back; losing a secret means rotating via delete + re-create. A
failed insert is a 500, never a fabricated 201 with a phantom id.
**Why:** the old REST route stored sha256(secret) and discarded the raw
secret, which made HMAC verification impossible for the customer AND for
our own signer, registry without delivery, and its catch block fabricated a
fake webhook id. Note the dashboard previously used a second, incompatible
`whsec:`-prefixed key derivation; ciphertexts created before this ADR are
not decryptable under the unified scheme (acceptable: nothing decrypted
them yet and secrets rotate by re-creation).
**Do not:** log the secret, return it from any endpoint other than create,
or introduce another key-derivation variant.

## ADR-034: One delivery drain, leased with FOR UPDATE SKIP LOCKED

**Status:** Accepted (2026-09-19, Phase 0 / M0.2)
**Decision:** `apps/api/src/lib/drain.ts` (behind `/v1/cron/drain`) is the
ONLY delivery-drain implementation; the ~320-line dashboard twin
(`apps/dashboard/app/api/cron/drain/route.ts`) and its Vercel cron entry
are deleted. Rows are claimed atomically,
`queued → sending` via `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
LOCKED)`, so overlapping invocations (scheduled tick + post-accept
kickDrain, multi-invocation serverless) own disjoint rows and can never
double-send. Claims are 10-minute leases: rows stuck in `sending`
(crash mid-flight) become re-claimable. Transient failures release the row
back to `queued` for the next tick.
**Why:** the twin implementations had already drifted, and the bare UPDATE
claim raced itself: two overlapping drains read the same `queued` rows and
sent the same email twice (a scheduled double-send in production).
**Do not:** add delivery logic to the dashboard again, or grep-replace the
claim with a read-then-update; the lease IS the correctness property.

## ADR-035: SES feedback arrives via SNS HTTPS; signature, origin, and monotonic state are the trust model

**Status:** Accepted (2026-09-19, Phase 1 / M1.1 + M1.2)
**Decision:** delivery feedback (delivery/bounce/complaint/open/click/reject)
reaches Calder exclusively through `POST /v1/ses/events`, a public endpoint
SNS posts to. Authentication is the SNS RSA-SHA1 signature over the
AWS-specified canonical string, with three hard gates, in order:

1. **Cert origin allowlist** — the signing certificate is fetched only from
   `https://sns.<region>.amazonaws.com(.cn)`; any other URL (http, lookalike
   host, userinfo trick, IP literal) is rejected *before* any fetch. Only
   `SignatureVersion: "1"` is accepted.
2. **Signature verification** — RSA verify against the fetched certificate's
   public key over the exact field ordering AWS specifies (Subject included
   only when present; SubscribeURL/Token for subscription types).
3. **Topic allowlist** — when `SES_SNS_TOPIC_ARNS` is configured, foreign
   topics are rejected; `SubscriptionConfirmation` is auto-confirmed ONLY
   when the allowlist exists and contains the topic (any subscriber can
   otherwise point a topic at the public URL).

Application is idempotent by construction: the raw notification lands in
`provider_events` (unique on SNS `MessageId`) FIRST, so SNS redelivery (it
retries non-2xx forever) short-circuits before state is touched twice.
Events join to `emails` via `providerMessageId` stamped at send; unknown
message ids are ledgered with `unmatched: true` and 200'd (someone else's
topic noise must not redeliver forever, and the ledger keeps forensics).

`emails.status` is monotonic (`created < queued < sending < sent < delivered`;
opened/clicked are *events only* — the schema deliberately has no such
status, matching Resend's model) and sticky (`bounced`/`complained`/`failed`/
`suppressed` are terminal, never overridden by late happy-path events).
Permanent bounces and complaints auto-insert `suppressions` rows (unique on
`(project_id, email)`, ON CONFLICT DO NOTHING), which M0.1's ingest path
already enforces 422 on — the SES reputation loop is closed. Transient
bounces record an event but NEVER change status or suppress: SES keeps
retrying, and soft-bounce suppression punishes greylisting and full inboxes.
**Why:** the endpoint is necessarily public, so the signature + cert origin
is the entire trust boundary; monotonicity + stickiness make out-of-order
SNS delivery harmless instead of corrupting truth.
**Do not:** move this behind API-key middleware (SNS cannot send our
headers); accept certificate URLs off the SNS allowlist; add "opened"/
"clicked" to `email_status`; or suppress on transient bounces.

## ADR-036: Usage metering is an append-only ledger with deterministic ids; quota is enforced at ingest against accepted mail

**Status:** Accepted (2026-09-21, Phase 2 / M2.1 + M2.2 + M2.3 + M2.4)
**Decision:** metering, quota and test-key isolation follow four rules, all
of which are PRICING §5 made mechanical.

1. **The ledger is exactly-once by construction.** When a provider accepts a
   send (drain or worker success path), ONE row is written to
   `usage_records` with id `ur_<emailId>`, quantity 1, plus the org's
   period stamps. INSERT ON CONFLICT (id) DO NOTHING makes retries,
   idempotent replays, overlapping drains and double-enqueues provable
   no-ops: the database key *is* the dedupe. Because `emails.id` is unique
   and metering keys on it, there is physically no way to double-count a
   send through the code paths that deliver mail.

2. **Quota is enforced at ingest, before persistence, against accepted
   mail — not the ledger.** `handleSendEmail` (which every ingest surface
   funnels through: `/v1/emails`, `/v1/emails/batch`, scheduled sends) plus
   the dashboard composer (which inserts directly, so it carries the same
   gate inline) count live `emails` rows created in the org's current
   period via the projects join. Queued mail counts: you cannot burst past
   the cap while mail is still landing. Over-limit sends are refused with
   402 `plan_limit_reached` carrying limit, usage, tier, periodStart and
   periodEnd (PRICING §5's "limit, usage and reset time" contract), plus a
   fix string pointing at upgrade. Nothing is persisted or queued for a
   refused send. Tier caps live in `@calder/config` `PLAN_LIMITS`
   (5,000/50,000/250,000/custom on the DB enum free/starter/pro/scale);
   unknown tiers resolve to the free floor — a typo'd tier must never mean
   unlimited. Calder's own org (`org_avenor`) is exempt: waitlist and auth
   mail must never be throttled by the platform it belongs to.

3. **Test keys are structurally isolated, not just discounted.** `emails`
   carries `env`, stamped at ingest from the API key's environment. In both
   the drain and the worker, `env='test'` short-circuits transport
   resolution entirely: the chain is exactly one leg, the mock provider —
   no SES, no Gmail, no matter what the registry holds. Metering skips
   non-`live` rows, and quota counting excludes them. The durable record
   (`provider: 'mock'`, `transport: 'mock'`) is the auditable proof a send
   never touched a real provider; it cannot be smuggled through transports
   because resolution never runs for those rows.

4. **Rollups are projections, not measurements.** `/cron/aggregate-usage`
   folds the ledger per (org, metric, period) into `usage_summaries` with
   deterministic id `ur_agg_<org>_<metric>_<periodStartISO>` upserted in
   place. Re-running the cron always converges to the same row; the usage
   page never trusts the summary alone — it reads the live
   accepted-mail count directly, so the bars are truthful even between
   cron runs. The Gmail daily cap also moved to *exact* accounting: only
   sends whose `transport = 'gmail'` (i.e. mail that actually went through
   Gmail) count toward it; SES volume can no longer exhaust a Gmail quota.
**Why:** a pricing promise that isn't enforced is false advertising, and
the previous draft quotas on the usage page (3,000/25,000/…) contradicted
PRICING.md — one table in config removes that drift class. Counting at
ingest-acceptance (not provider-accept) is what makes burst-limit holds;
metering at provider-accept is what makes the invoice match reality; both
are true simultaneously because they answer different questions (throttle
vs bill).
**Do not:** meter at ingest (queued mail that never delivers must not be
billed); meter more than one unit per row (per-recipient pricing is a
future pricing change, not an implementation detail); let test-env rows
reach `resolveChain`/`resolveServiceChain` even to "peek"; trust
`usage_summaries` for quota decisions (it lags by a cron interval); or
reintroduce a per-app local quota table — `PLAN_LIMITS` is the only copy.

## ADR-037: Gmail is an on-ramp, not infrastructure — revocation auto-marks, velocity graduates from warn to suspension, every step audit-logged

**Status:** Accepted (2026-09-21, Phase 2 / M2.4 tail + M2.5)
**Decision:** a connected Gmail account is treated as a development/small-app
on-ramp with progressive, visible, auditable pressure toward real
deliverability infrastructure:

1. **Revocation is terminal and auto-detected.** When the Gmail API answers
   `invalid_grant` at send time (`code: "gmail_revoked"`), drain and worker
   flip `project_transports.status` to `revoked` in a single
   `UPDATE ... WHERE status = 'active'` (the transition itself is the
   exactly-once switch), write one `transport.gmail_revoked` audit row, and
   fail the CURRENT send over to the next chain leg (SES) instead of
   failing this email and every successor against a corpse credential.
   Chains only build legs from `status = 'active'` rows, so the flip
   permanently retires the leg.

2. **Velocity is graded, and the policy core is a pure function.**
   `assessGmailVelocity` maps (lastHour, today, 7-day average) onto
   `ok | warn | limit | suspend`: warn ≥ 40/h writes a debounced
   (24h) `transport.gmail_velocity_warn` audit row and lets mail run;
   limit ≥ 120/h refuses the leg *transiently* (429, retry-in-this-hour,
   failover-friendly); suspend ≥ 600/h — or sustained outgrowth (7-day avg
   ≥ 100 with today's cap already reached) as a limit, not suspension —
   flips the transport to `suspended` (same exact-once transition trick),
   audits once, and refuses *permanently* (403) with a message that names
   the remedy. Thresholds live behind env vars
   (`GMAIL_WATCH_WARN_PER_HOUR`/`_LIMIT_`/`_SUSPEND_`) over
   `DEFAULT_GMAIL_WATCH`. The audit trail is written from the drain AND the
   worker, and the watch runs BEFORE credential decryption, so it cannot
   leak secrets into failure paths and tests need no real Gmail accounts.

3. **Appeals are actions, not tickets.** Control → Security → Abuse shows
   every connected Gmail account (org/project/last-hour velocity/today-vs-cap/
   status/last-used), plus the watch's own audit feed. Re-activating a
   `suspended` transport is a guarded server action
   (`transport.gmail_reactivated` audited with the actor). `revoked` is
   never re-activatable from control — the OAuth grant itself is dead, only
   the account owner can reconnect, and pretending otherwise would paper
   over a break the customer must actually fix.

4. **Graduation is a prompt, not a punishment.** When a project's Gmail
   usage crosses the graduation line (7-day average ≥ 100/day or today's
   cap reached), the Senders page shows an outgrowth banner pointing at
   domain verification: SES takes over with no code change. The banner is
   informative; the velocity ladder is the enforcement.
**Why:** PRICING.md's Beginner tier cannot stay generous if one connected
Gmail account can become a relay, but banning Gmail upfront strangles
activation. Graded pressure with an audit trail converts the risk into a
funnel: warn (visible), limit (recoverable), suspend (appealable) — and the
escape hatch is always "verify a domain, deliver properly".
**Do not:** swallow abuse-watch errors into a silent SES fallback (a
swallowed "suspended" is a silent bulk path — only `gmail_cap`,
`sender_not_ready` and generic resolution errors may fall back);
re-activate revoked transports from control; run the velocity assessment
after decryption (watch before secrets); or warn more than once per 24h per
transport (rate-limit your own rate-limiting alerts).

## ADR-038: Webhook deliveries are durable-first, signed Stripe-style, retried on an exponential ladder, and replay creates new rows

**Status:** Accepted (2026-09-24, Phase 3 / M3.1 + M3.2)
**Decision:**

1. **The delivery row is the source of truth and is written BEFORE the queue
   job** (`createPendingDeliveries` then `enqueueWebhookDeliveries`, shared by
   the API replay path and the worker emit path in
   `@calder/db/webhook-deliveries`). If the queue leg throws we still have the
   durable row; a reconciler can re-and-queue from `pending` + `next_attempt_at
   <= now`. Consumers that find a dangling job with no row log and drop — they
   never invent rows.

2. **Signing follows the Stripe/Resend convention.** Every POST carries
   `webhook-id: <deliveryId>` and `webhook-signature: t=<unix>,v1=<hex>` where
   `v1 = HMAC-SHA256(secret, "<t>.<body>")` and the body is the exact JSON of
   the stored `webhook_deliveries.payload` envelope `{id, type, createdAt,
   data}`. Verification = parse `t`/`v1`, recompute, **timing-safe** compare,
   reject when `|now − t| > 300s` (replay-window defense). `verifySignature`
   ships in `@calder/worker/webhook-consumer` for SDK extraction later.

3. **Retry is an explicit exponential ladder, not a formula** —
   5s, 30s, 2m, 10m, 30m, 2h, 6h — encoded as `RETRY_SCHEDULE_MS` with
   `nextRetryDelayMs(failedAttempt)`. Delivery 8 with all retries spent flips
   to permanent `failed`; nothing is ever retried forever. Success is any
   2xx and records (latencyMs, responseStatus, deliveredAt); the 10s timeout
   is an AbortController on the fetch. Terminal failures (deleted/disabled
   endpoint, SSRF-refused URL, undecryptable secret) short-circuit to
   `failed` without burning the ladder.

4. **SSRF defense exists on BOTH sides of the crate** —
   `isPublicWebhookUrl` in `@calder/validation` (https-only, no userinfo,
   blocks localhost/`*.local` and every private/CGNAT/link-local/multicast
   IPv4 and ULA range; explicit `allowLoopback` flag for dev) runs in the API
   on create (400 with reason) and **again in the worker at delivery time**
   (DNS rebinding pinching a hostname between registration and dispatch is
   the classic skip).

5. **Replay is always a NEW delivery row carrying the original `data`** —
   never a mutation of history. Receivers dedupe on the business id inside
   `data` (e.g. `emailId`); the endpoint only replays to its own source
   webhook (no broadcast). **Rotation** replaces the AES-256-GCM
   (`webhook_signing` context) secret, shows the new raw value once, and
   invalidates the old secret for all future signing immediately; historical
   signatures stay verifiable by whatever secret the receiver had at the time.

**Why not:** a fixed geometric backoff (`2^n·5s` capped) is harder to reason
about under clock skew and harder to unit-test exhaustively; sig-over-body
without a timestamp opens replay windows; mutate-in-place replays destroy the
audit story (M5.1's audit views assume immutable delivery history).
**Consequences:** the `webhook:deliver` queue now has exactly one consumer,
all signing paths are testable as pure functions (6 signature vectors),
and the dashboard per-endpoint "Deliveries" panel is read-only over rows the
system already wrote — no new truth was invented for the UI.

## ADR-039: Domain ownership is a state machine over a 192-bit DNS-TXT challenge; deliverability identity is SES-linked and DKIM-stored

**Status:** Accepted (2026-09-24, Phase 4 / M4.1 + M4.2)
**Decision:**

1. **Challenge contract:** control of `example.com` is proven by publishing
   `_calder.example.com TXT "calder-verification=cvt_<48 hex>"` (192 bits,
   `crypto.randomBytes(24)`). Legacy `calder_verify_*` rows are treated as
   challenge-free and must regenerate — the old display format was
   demonstrator theater (double-prefixed tokens), not a live contract.

2. **State machine on `domains.status`:** `pending → verified` (exact TXT
   match), `pending|failed → failed` (mismatch, retryable),
   `pending|failed → expired` (72h TTL checked on read, no cron —
   `sweepExpiredChallenges` runs inside list/verify), `expired → pending`
   (explicit `POST /:id/token` reissue). `verified` is terminal per row;
   the flip is `UPDATE ... WHERE status != 'verified'` so concurrent
   attempts cannot double-write the transition or its audit row
   (`domain.verified` in `audit_logs`).

3. **Abuse control:** 10 verify attempts / rolling hour / domain
   (`verify_attempts` + `verify_window_start`, rolled forward in the same
   write as the outcome) with SEP retry hints; **cross-tenant denial** —
   a domain already `verified` by another project rejects both registration
   and verification attempts with 409 (first proof wins; disputes go to
   support).

4. **DNS oracle is injectable; production resolves twice.** Attempts call
   `attemptVerification(db, projectId, domainId, oracle?)` from
   `@calder/db/domain-verification` — the same code path the API routes AND
   the dashboard wizard use. Prod oracle = system `resolveTxt` (5s) with a
   DoH fallback (`dns.google/resolve`, 4s) because fresh TXT reaches
   public authoritative DNS before recursive caches. Propagation failures
   are data, not honors: mismatch responses carry expected-vs-found
   (bounded to 5 records), DNS errors are retryable `dns_error` outcomes.

5. **Deliverability identity (M4.2):** after ownership verifies,
   `POST /:id/ses/link` registers the SES identity idempotently, stores the
   3 DKIM CNAMEs (`dkim_records` jsonb) + `dkim_status`, and returns SPF
   guidance (`v=spf1 include:amazonses.com ~all`, displayed not asserted —
   many tenants keep their own SPF). `POST /:id/ses/refresh` polls
   `VerifiedForSendingStatus`; the wizard auto-polls every 20s while DKIM
   is pending. Verified-sending ≠ verified-ownership: branding is its own
   gate and unverified-branding send continues to work.

6. **M4 hard gate:** over-cap Gmail now refuses with a message that names
   the domain-verification remedy (both drain and worker paths — the error
   text is the contract, and integration tests regex it), and the sender
   graduation banner links straight to `/domains`.

**Why not:** checking `example.com TXT` at apex (forces SPF merges and
breaks multi-tenant CNAME consumers); cron-swept expiry (non-deterministic
at read time); trusting clients to self-report verification (Phase-3
theater pattern this replaces); a *compat window* for legacy tokens
(neither the API nor the dashboard ever verifiably accepted them).
**Consequences:** `domains.verifyAttempts/windowStart/expiresAt/lastError`
+dKIM columns shipped in migration `0021_domain_trust`; SES linkage needs
AWS creds wherever the dashboard/API runs the link action; the Flow-D
manual pass is pending a live DNS zone + AWS credentials.

## ADR-040: Auth hardening — provider-verified OAuth linking, database lockout, reset-revokes-sessions, v2 OTP HMAC, bounded magic callback, mandatory cron secret

**Status:** Accepted (2026-09-25, Phase 6 / M6.1)
**Decision (the §11 H4 + M4 + M7 + M8 batch, shipped together):**

1. **OAuth auto-linking requires a provider-verified email, period (H4).**
   Previously: an unverified-at-provider email linked to an existing Calder
   account whenever the Calder row had ANY verification state — meaning an
   attacker setting their unverified GitHub/Google email to a victim's
   address could sign in AS the victim (both providers expose the flag:
   Google `email_verified`, GitHub `/user/emails` primary.verified). Now:
   the unverified branch always raises ("sign in with your original method
   to link"); verified linking also upgrades a null `email_verified_at` on
   the Calder side, since provider-side verification IS email control.

2. **Progressive account lockout is database state, before scrypt.**
   `users.failed_login_attempts` + `locked_until`: check runs BEFORE the
   password hash compare, so a locked account costs zero CPU. Below 3
   failures no lock; from the third, exponential 30s → 1m → 2m … capped at
   30m (`lockoutDelayMs`, unit-tested). Success resets both fields; reset
   clears lockout too. Unknown emails get no row-update (enumeration-safe).
   Responses surface HTTP 429 + Retry-After, distinct from the route's
   per-IP/per-email limiter (which stays).

3. **Password reset revokes every session.** The mailbox is the recovery
   oracle: redeeming a reset code proves mailbox possession, so
   `revokeAllSessions(userId)` runs atomically after the hash swap. Session
   inventory + self-service revoke ship with it: sessions capture
   user-agent/IP at creation (optional-throughout, old rows are null), a
   throttled last-seen touch (≤1 write / 5 min / session) keeps inventory
   fresh, and Settings exposes per-session revoke + "sign out everywhere
   else" (keep current).

4. **OTP storage upgrades to v2 peppered HMAC** (v1 was bare sha256 over a
   6-digit ≈ 1M-entry space — offline-bruteforceable in seconds if hashes
   ever leak). v2 = `HMAC-SHA256(AUTH_SECRET||"email-code-v2",
   purpose|email|code)`: purpose+email binding also closes the
   reset-code-as-verification-code confusion. Dual-accept window: issued
   rows keep verifying under v1 for their ≤10-minute TTL post-deploy;
   everything new issues v2. Timing comparison preserved.

5. **The magic-link callback is rate-bounded** (20 consumes/min/IP via the
   shared limiter): GET-by-design endpoints can't lean on the issuance
   rate limit. Throttled callbacks land on /login with an error flag.

6. **`CRON_SECRET` is mandatory in production.** A bare `x-vercel-cron`
   header is forgeable and stopped counting from now on; dev keeps the
   convenience branch only. Prod w/o secret = drained denied, loudly.

**Also shipped:** Redis-backed limiter, ADR-041; migration
`0022_auth_hardening` (users.failed_login_attempts/locked_until,
sessions.user_agent/ip/last_seen_at).
**Residual (documented, accepted):** email-client link prefetch can still
consume a magic link before the human clicks; the 256-bit single-use
design means the consequence is an annoying re-request, not an account
breach, and the fix (confirm-step page) is a UX trade left for later.

## ADR-041: Rate limiting is Redis-fixed-window in production, in-memory elsewhere, with a loud degraded-mode fallback

**Status:** Accepted (2026-09-25, Phase 6 / M6.1)
**Decision:** `RedisRateLimiter` (INCR + PEXPIRE in one MULTI, fixed window)
now backs `getRateLimiter()` whenever `REDIS_URL` is set — wired by
`configureRateLimiterFromEnv()` at API boot and dashboard instrumentation.
**Why not sliding-window:** MULTI-atomic fixed windows keep the Lua surface
zero and one round-trip per check; boundary burst is acceptable on auth
endpoints that also carry attempt counters and lockouts. **Degraded mode:**
Redis down → per-instance memory + endpoint-native caps still engage;
REDIS_URL absent in prod → loud boot warning (operators must hear that
limits are approximate). This closes §11 M2's "in-memory limiter multiplies
across Vercel instances" without schema changes.

## ADR-042: Official SDKs exist as four language clients sharing one behavior contract

**Status:** Accepted (2026-09-25, production-essentials beyond Phase 6)
**Decision:** ship Node (`packages/sdk-node`), Python (`sdks/python`), Ruby
(`sdks/ruby`) + PHP (`sdks/php`) as first-party clients with an identical
contract (see `sdks/README.md`): idempotency header on every send (UUID
default), exactly one jittered-backoff retry for 5xx/429/network, typed
error taxonomy (Auth/RateLimit/Request/Calder base), 10s default timeout,
zero third-party dependencies per client.
**Why not generator-driven (OpenAPI→client):** the surface is deliberately
narrow (send/get/list) and hand-rolled contracts read better for the
launch-era audience; generation can be revisited when endpoint count grows.
**Status honesty:** Node + Python have in-repo test suites (13 + 14 green);
Ruby + PHP were authored without runtimes in the sandbox and are marked
beta/source-available until CI gains those toolchains. Publication
(npm/PyPI/gem/Packagist) is owner-manual per the publish steps in
`sdks/README.md`; the dashboard SDK hub only ever shows what exists.
