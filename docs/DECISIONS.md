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
