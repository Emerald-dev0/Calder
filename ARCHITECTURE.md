# Avenor — Architecture

For _why_ specific choices were made, see `docs/DECISIONS.md`. For visual/frontend direction, see `docs/DESIGN.md`.

## 1. High-level flow

```
Client → API (Hono) → Validate → Persist (Postgres) → Enqueue → 202 Accepted
                                                            │
                                                            ▼
                                                        Worker → Provider (SES) → Events → Webhooks
```

## 2. Services

- **apps/web** — marketing site (editorial, expressive)
- **apps/dashboard** — customer-facing app (precise, dense, functional)
- **apps/api** — public REST API
- **apps/worker** — send queue, retries, scheduled/cron jobs

## 3. Data layer

PostgreSQL is the single source of truth. Core entities: `users`, `organizations`, `memberships`, `projects`, `api_keys`, `domains`, `domain_verifications`, `templates`, `template_versions`, `emails`, `email_events`, `webhooks`, `webhook_deliveries`, `suppressions`, `subscriptions`, `plans`, `plan_prices`, `usage_records`, `otp_challenges`, `provider_accounts`, `provider_events`, `audit_logs`. All schema changes via migrations (Drizzle CLI — see `AGENTS.md` CLI-first tooling).

## 4. Multi-tenancy

```
Organization → Project → API Key / Domain / Email / Template
```

Every tenant-data query must be scoped at the data-access layer, not just route middleware.

## 5. Provider abstraction

```
Avenor → EmailProvider interface → SES adapter (v1) → [future adapters]
```

Same pattern for `PaymentAdapter` (→ Bachs) and `HostedDomainProvider` (→ Vercel first).

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

Applied per IP, API key, project, organization, endpoint, provider — with independently configurable limits per category (auth, sending, verification, webhooks, OTP, dashboard).

## 11. Caching

Redis-compatible store for rate limiting, idempotency, locks, and config/verification-state caching. Every cache entry has a TTL, invalidation strategy, and fallback. Never a second source of truth.

## 12. Observability

Structured JSON logs, `request_id` tracing, metrics (API latency/errors, send/delivery/bounce/complaint rates, queue depth, worker/provider/webhook failures), exceptions correlated to `request_id`.

## 13. Health checks

`/health` (liveness) and `/ready` (readiness, dependency-inclusive). A degraded database should generally fail readiness, not liveness.

## 14. System design: why a modular monolith, and when that changes

Avenor deliberately does **not** start as microservices — see ADR-007 in `docs/DECISIONS.md`.

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
apps/api            — validation, auth, tenant-scoped reads/writes, enqueue
apps/worker          — send execution, retries, webhook delivery, cron
packages/providers   — natural first split candidate (e.g. SES throughput bottleneck)
packages/billing     — natural second candidate (different consistency needs)
```

## 15. Frontend architecture notes

- **Lenis** provides smooth scrolling on `apps/web` (marketing) and, more conservatively, `apps/dashboard` where it doesn't interfere with data-dense scrolling (e.g. long log tables) — see `docs/DESIGN.md` §8 for when motion is and isn't appropriate.
- Motion/scroll-linked effects must respect `prefers-reduced-motion` — Lenis and any scroll-triggered animation are disabled or reduced to instant-jump behavior for users who request it.
- Shared visual primitives (typography scale, color tokens, spacing scale, the "Avenor Signal" motif) live in `packages/ui` and are consumed by both `apps/web` and `apps/dashboard` so the two surfaces stay in the same visual universe without being identical.

## 16. Deployment & CLI tooling

Deployments to preview and production environments go through the `vercel` CLI where applicable, and repo/PR operations go through `gh` (GitHub CLI) — see `AGENTS.md` § "CLI-first tooling." This keeps the deployment and review trail scriptable and auditable rather than dependent on manual dashboard steps.
