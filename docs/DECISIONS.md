# Architecture & Product Decisions

Record any decision that (a) reverses something already built, or (b) a reasonable engineer or AI agent might later be tempted to "fix." Skip obvious/easily-reversible decisions.

---

## ADR-001: PostgreSQL is the source of truth

**Status:** Accepted
**Decision:** PostgreSQL is Avenor's single authoritative datastore.
**Why:** relational consistency, transactional support, fits multi-tenant + billing + event data.
**Alternatives considered:** MongoDB, DynamoDB — rejected for weaker consistency guarantees.

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
**Options:** send via an Avenor-managed subdomain mapped to the verified project; investigate Vercel DNS delegation; restrict to informational verification until a mechanism is validated.
**Must be resolved with a working prototype before shipping past MVP-adjacent status.**

---

## ADR-006: OTP MVP inclusion — undecided

**Status:** Open
**Decision:** deferred — revisit after the core email golden path works end-to-end.

---

## ADR-007: Modular monolith over microservices at launch

**Status:** Accepted
**Decision:** one API deployable, one worker deployable, shared packages with enforced boundaries — not independently deployed services.
**Why:** no current team/scale/reliability pressure justifies the operational cost. Package boundaries are kept clean so a future split doesn't require a rewrite — see `ARCHITECTURE.md` §14 for concrete split triggers.
**Alternatives considered:** microservices from day one — rejected per PRD as premature complexity.

---

## ADR-008: Editorial Infrastructure as the locked design direction

**Status:** Accepted
**Decision:** Avenor's visual identity sits between Linear/Stripe-style technical precision and high-end editorial/Awwwards-level art direction — never a generic purple-gradient SaaS look.
**Why:** design is treated as a differentiator (per PRD §13), not decoration; a distinctive visual identity is one of Avenor's few defensible moats against feature-parity competitors.
**Enforcement:** `docs/DESIGN.md` is authoritative; any UI PR requires the visual QA loop in `AGENTS.md` (render → screenshot → self-review against the checklist → iterate → attach evidence) before merge, specifically to catch cases where a color or layout is technically correct but reads wrong once actually rendered.

---

## ADR-009: Lenis for smooth scroll

**Status:** Accepted
**Decision:** Lenis powers scroll behavior on `apps/web`, used more conservatively on `apps/dashboard`.
**Why:** scroll-driven storytelling is core to the homepage's "invisible infrastructure made visible" concept (`docs/DESIGN.md` §7); Lenis is a well-established, lightweight option for this rather than building custom scroll physics.
**Constraint:** must degrade cleanly under `prefers-reduced-motion` and must not regress core web vitals (see `docs/DEPLOYMENT.md` performance targets) — this is a hard constraint, not a nice-to-have.

---

## ADR-010: CLI-first over dashboard-first tooling

**Status:** Accepted
**Decision:** Prefer `gh` (GitHub CLI), `vercel` CLI, and equivalent CLIs for any tool that has one, over manual web-dashboard operations.
**Why:** scriptable, diffable, reproducible, and auditable in PR history — particularly important once AI agents are doing meaningful portions of the operational work, since dashboard clicks leave no reviewable trace.
**Scope:** applies to repo/PR management, deployments, environment variable management, and database migrations at minimum; extend to other tools (Bachs, etc.) as CLIs become available.

---

## ADR-011: Scaffold queue is in-memory with a drop-in Redis path

**Status:** Accepted
**Decision:** `packages/queue` ships an `InMemoryQueue` behind the `Queue<T>` interface; a Redis-backed implementation replaces it without changing API/worker code.
**Why:** unblocks the API → queue → worker → provider vertical slice locally with zero infra; the interface (enqueue/enqueueDelayed/process/close/drain) is the contract, not the backend.
**Constraint:** InMemory must never be used in production — multi-instance deployments would lose jobs. `getRateLimiter` has the same rule.

---

## ADR-012: ESLint 8 (not 9) for the scaffold

**Status:** Accepted
**Decision:** pin `eslint@8` with `.eslintrc.cjs` until the repo migrates to flat config deliberately.
**Why:** ESLint 9 drops `.eslintrc` and `--ext`; adopting flat config is a separate, deliberate migration, not scaffold fallout.

---

## ADR-013: API-key hashing is SHA-256 + pepper, not bcrypt

**Status:** Accepted
**Decision:** API keys are verified via SHA-256 hex with constant-time comparison (`timingSafeEqual`).
**Why:** keys are checked on every API request — bcrypt's cost would add unacceptable per-request latency. Entropy comes from 24 random bytes + optional `API_KEY_PEPPER`, not from a slow hash.

---

## ADR-014: SMTP gateway as a separate deployable converging on one pipeline

**Status:** Accepted (topology: gateway process TBD — see open points)
**Decisions:**

1. Avenor supports SMTP alongside REST because beginners and existing stacks
   (WordPress, Laravel, Django, Nodemailer/smtplib users) already speak it —
   meeting them at their protocol beats teaching an abstraction. No invented
   SMTP extensions; standard AUTH/STARTTLS/MAIL/RCPT/DATA/MIME only.
2. SMTP and REST converge after ingestion into one email model, one queue, one
   worker fleet, one event lifecycle, one usage meter. Two delivery systems are
   banned by design, not just by review.
3. Credentials are project-scoped (never account-global), shown once, hashed at
   rest — unlike the industry default of reusing one API key as the SMTP password.
4. The gateway is its own deployable (`apps/smtp-gateway`), sharing queue/pipeline
   packages. Justification under ADR-007: long-lived TCP connections vs short HTTP
   requests (different scaling/failure profile), an abuse-sensitive public ingress
   (different security boundary), and protocol-specific deploy risk. All three map
   to accepted split triggers — this is not "felt cleaner."
5. Load balancing is TCP pass-through (HAProxy/NLB-class, least-conn, health
   checks); TLS terminates at the gateway, never the LB — validated against
   industry practice (STARTTLS lives inside the TCP session; terminating it
   upstream complicates the protocol and the audit trail).
   **Why:** SMTP is the migration path and the beginner path; one pipeline keeps
   billing, events, and guarantees coherent across interfaces.
   **Open (must validate before GA):** managed TCP-LB provider choice; cert rotation
   mechanism; attachment size caps; `X-Avenor-*` extension header set.

---

## ADR-015: Dashboard reads via server components + tenant helper

**Status:** Accepted
**Decision:** Dashboard pages query Postgres directly in Server Components
through `getTenantContext()`, instead of HTTP calls to our own API.
**Why:** server components execute on the server (BFF pattern, not client DB
access); an HTTP hop would add latency plus a second auth mechanism with no
isolation gain. Enforcement lives in the helper (seal + expiry + revocation +
project scoping), and middleware is documented as presence-check only.
**Constraint:** every new dashboard query must go through the helper —
raw `getDb()` in a page without tenant scoping is a bug.
