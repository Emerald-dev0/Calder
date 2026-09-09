# Calder, Architecture

For _why_ specific choices were made, see `docs/DECISIONS.md`. For visual/frontend direction, see `docs/DESIGN.md`.

## 1. High-level flow

```
Client → API (Hono) → Validate → Persist (Postgres) → Enqueue → 202 Accepted
 │
App ──→ SMTP Gateway → Normalize → Persist (Postgres) → Enqueue → 250 Queued
 │
 ▼
 Worker → Provider (SES) → Events → Webhooks
```

REST and SMTP are interfaces into one pipeline: same email model, same queue,
same worker, same events, same usage meter. There is exactly one delivery system.

## 2. Services

- **apps/web**, marketing site (editorial, expressive)
- **apps/dashboard**, customer-facing app (precise, dense, functional)
- **apps/api**, public REST API
- **apps/smtp-gateway**, SMTP ingress (AUTH, STARTTLS, MIME normalize → shared pipeline)
- **apps/worker**, send queue, retries, scheduled/cron jobs

## 3. Data layer

PostgreSQL is the single source of truth. Core entities: `users`, `organizations`, `memberships`, `projects`, `api_keys`, `smtp_credentials`, `domains`, `domain_verifications`, `templates`, `template_versions`, `emails`, `email_events`, `webhooks`, `webhook_deliveries`, `suppressions`, `subscriptions`, `plans`, `plan_prices`, `usage_records`, `otp_challenges`, `provider_accounts`, `provider_events`, `audit_logs`. All schema changes via migrations (Drizzle CLI, see `AGENTS.md` CLI-first tooling).

## 4. Multi-tenancy

```
Organization → Project → API Key / Domain / Email / Template
```

Every tenant-data query must be scoped at the data-access layer, not just route middleware.

## 5. Provider abstraction

```
Calder → EmailProvider interface → SES adapter (v1) → [future adapters]
```

Same pattern for `PaymentAdapter` (→ Bachs) and `HostedDomainProvider` (→ Vercel first).

## 5b. SMTP gateway

`smtp.calder.com:587` (STARTTLS; 465 implicit-TLS reserved). Standard SMTP,
AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO, DATA, MIME (HTML/text/attachments, CC/BCC/
Reply-To, custom headers), no custom protocol, no invented extensions. Optional
Calder-specific headers (e.g. template selection) are documented as extensions,
never as protocol.

```
SMTP client → TCP LB (pass-through, no TLS termination)
 → Gateway → AUTH (project-scoped credential) → MIME parse → validate
 → normalize to Email model → persist → enqueue → `250 Queued`
```

- Credentials are per-project: generated secret shown once, hashed at rest,
 rotatable, revocable, last-used tracked, audit-logged. TLS + AUTH mandatory;
 anonymous relay impossible by construction.
- Sender authorization: envelope-from must belong to a verified project identity
 (own domain, or Calder-managed identity for onboarding), spoofing fails closed.
- Rate limits reuse the central limiter at IP/project/org/credential/connection/
 message/recipient dimensions; Redis-backed counters.
- Billing meters at the canonical accepted-send event, identical for API and SMTP.
- Observability: connections, auth success/failure, SMTP codes, submission→message
 ID→job→provider ID trace, all correlatable in the dashboard.
- Full protocol/support-matrix spec: `docs/SMTP.md`. Service-boundary justification:
 ADR-014.

## 5c. Transports & graduation

Delivery moves through per-project **transports** (`project_transports`):
Gmail (OAuth-connected, capped) → SES → future managed infrastructure. The worker
resolves each job's transport at send time, active default wins, suspended/
revoked fail closed, absent means the global SES/mock provider:

```
job → load project_transports → pickDefaultTransport()
 → gmail? cap-check → GmailTransport → Gmail API
 → else? SES (creds) / mock (dev)
```

- The API, keys, logs, templates, events, and usage meter never change when the
 transport does. Graduation (Gmail → verified domain → managed infra) is a row
 update, not a reintegration, the onboarding "how do you want to send?" choice
 (Connect Gmail vs Add domain) writes the first default transport.
- Gmail credentials: OAuth refresh tokens, AES-256-GCM encrypted, minimum
 `gmail.send` scope, decrypted only in-memory at send time. No passwords, ever.
- Caps enforced pre-send per UTC day (default 400 Gmail); over-cap fails
 permanently with an explainable error pointing at graduation, never silently,
 never over Google's limits.
- Interface: `EmailTransport` extends `EmailProvider` (+ capabilities, health).
 New transports implement the interface; the pipeline never branches on type.
- Campaigns (post-MVP) build on audiences/consent/scheduling tables that do not
 exist yet, deliberately. Transactional sends never share reputation pools or
 code paths with future bulk sending.

## 6. Queue & retries

Redis-compatible queue. Exponential backoff with jitter for transient failures; permanent failures don't retry. Exhausted jobs move to dead-letter state (reason, attempts, last error, replayable). All cron jobs idempotent and safe to re-run.

## 7. Idempotency

`Idempotency-Key` header required for mutating operations where duplication causes harm (sends, charges).

## 8. Email lifecycle

```
created → validated → queued → provider accepted → sent → delivered
 ↘ failed / bounced / complained
delivered → opened → clicked
```

## 9. Suppression

Checked before every send; suppressed sends are blocked with a logged reason, not silently dropped.

## 10. Rate limiting

Applied per IP, API key, project, organization, endpoint, provider, with independently configurable limits per category (auth, sending, verification, webhooks, OTP, dashboard).

## 11. Caching

Redis-compatible store for rate limiting, idempotency, locks, and config/verification-state caching. Every cache entry has a TTL, invalidation strategy, and fallback. Never a second source of truth.

## 12. Observability

Structured JSON logs, `request_id` tracing, metrics (API latency/errors, send/delivery/bounce/complaint rates, queue depth, worker/provider/webhook failures), exceptions correlated to `request_id`.

## 13. Health checks

`/health` (liveness) and `/ready` (readiness, dependency-inclusive). A degraded database should generally fail readiness, not liveness.

## 14. System design: why a modular monolith, and when that changes

Calder deliberately does **not** start as microservices, see ADR-007 in `docs/DECISIONS.md`.

**Initial shape:**

```
Web → API → Postgres → Queue → Worker → SES
```

One API deployable, one worker deployable, shared packages with enforced internal boundaries.

**Why not microservices now:** no team-ownership pressure yet, no proven independent-scaling need beyond API/worker already being separate deployables, network calls add latency/failure modes/observability burden not yet justified, and splitting early means guessing boundaries before usage reveals them.

**Concrete triggers that would justify splitting a package into its own service:**

- A component needs to scale independently at a rate current deployables can't absorb
- A component has a genuinely different reliability profile (e.g. sub-100ms OTP verification vs. minutes-tolerant billing reconciliation)
- A separate team takes ownership and needs independent deploy cadence
- A hard technical reason requires a different language/runtime

Any PR proposing a new service must cite which trigger applies.

**Service boundary map (for when the split eventually happens):**

```
apps/api, validation, auth, tenant-scoped reads/writes, enqueue
apps/worker, send execution, retries, webhook delivery, cron
packages/providers, natural first split candidate (e.g. SES throughput bottleneck)
packages/billing, natural second candidate (different consistency needs)
```

## 15. Frontend architecture notes

- **Lenis** provides smooth scrolling on `apps/web` (marketing) and, more conservatively, `apps/dashboard` where it doesn't interfere with data-dense scrolling (e.g. long log tables), see `docs/DESIGN.md` §8 for when motion is and isn't appropriate.
- Motion/scroll-linked effects must respect `prefers-reduced-motion`, Lenis and any scroll-triggered animation are disabled or reduced to instant-jump behavior for users who request it.
- Shared visual primitives (typography scale, color tokens, spacing scale, the "Calder Signal" motif) live in `packages/ui` and are consumed by both `apps/web` and `apps/dashboard` so the two surfaces stay in the same visual universe without being identical.

## 16. Deployment & CLI tooling

Deployments to preview and production environments go through the `vercel` CLI where applicable, and repo/PR operations go through `gh` (GitHub CLI), see `AGENTS.md` § "CLI-first tooling." This keeps the deployment and review trail scriptable and auditable rather than dependent on manual dashboard steps.
