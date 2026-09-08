# Calder — Product Requirements Document (v0.2)

Status: Pre-launch. Rebrand (Avenor → Calder) + transport architecture adopted.
Category: Developer infrastructure / transactional communication
Initial primitive: Transactional email

## 1. Summary

Calder is developer-first communication infrastructure, starting with transactional email and designed to expand into a broader communication layer (OTP, SMS, push) without architectural rework.

Positioning: **Calder — the easiest way to add reliable transactional email to an application.** Communication infrastructure that gets out of your way. Differentiation comes from developer experience + domain intelligence + debuggability + predictable pricing + distinctive design, combined — not any single feature.

## 2. Problem

Developers need application-generated transactional communication but implementing it well means handling providers, DNS/SPF/DKIM/DMARC, templates, queues, retries, webhooks, suppression, and billing — usually fragmented. Calder turns this into one coherent developer experience.

## 3. Users

**Targeting:** indie developers, startups, SaaS companies, engineering teams — plus junior developers and teams with existing SMTP-based stacks (WordPress, Laravel, Django, legacy systems) who need infrastructure without replatforming.

**First market, not ceiling:** Nigeria-first — NGN pricing, local payment rails, onboarding that assumes no domain and no budget. The product must never look geographically limited: same API, same reliability bar, global ambition. Nigeria is the wedge (accessible pricing, Gmail-first beginners, underserved builders), not the boundary.

**Not targeting (initially):** newsletter platforms, marketing automation, CRM, bulk/broadcast email.

## 4. Core model

```
Organization (billing/ownership boundary)
  └── Projects (app/environment separation)
        ├── API Keys (test/live)
        ├── Transports (gmail → ses → managed; default per project)
        ├── Domains
        ├── Templates
        └── Emails → Events
```

## 5. Core modules (MVP scope)

Email API, **SMTP gateway (same pipeline, project-scoped credentials)**, **transport abstraction + Gmail Quickstart (OAuth, capped, graduates to domains)**, domain verification (DNS-based), async queue + worker, provider abstraction (SES first), retries with backoff, idempotency, full email event lifecycle, signed/retried webhooks, usage metering from authoritative records, basic dashboard, NGN-first billing integration.

## 6. Post-MVP

Templates (+ playground: pick welcome/OTP/receipt → preview → test → publish → copy code), OTP infrastructure, advanced analytics, scheduling, batch sending, suppression management UI, domain health dashboard, Vercel hosted-domain verification, additional SDKs, campaign architecture (audiences, consent, scheduling — designed, not built; see §18), automations (event → condition → delay → email; priced separately), inbound email (user → Calder → app webhook), CLI (`calder doctor` diagnostics first), MCP server for coding agents, migration assistant (Resend/Postmark mapping guides + codemod — guides, never API cloning), Email Debugger (per-email trace view), "why didn't it arrive" explainer.

## 7. Later

Multi-provider failover, advanced deliverability tooling, dedicated IPs, roles/SSO, regional infrastructure, enterprise controls.

## 8. Distinctive feature: hosted-project domain verification

Verifying a developer controls a `*.vercel.app` project doesn't by itself satisfy SPF/DKIM/DMARC on a zone they don't control. **Open problem** — see `docs/DECISIONS.md` ADR-005. Candidate resolution: send via an Calder-managed subdomain mapped to the verified project rather than literally sending "from" the platform-hosted address.

## 9. OTP infrastructure — status undecided (MVP vs. immediately post-MVP)

Email-based OTP: create/verify challenge, expiration, attempt limits, replay prevention, rate limiting, audit events.

## 10. API conventions

Versioned from first release (`/v1/...`). Predictable error shape: `{ error: { code, message, request_id } }`. API keys: `test`/`live`, hashed at rest, prefixed, revocable, rotatable.

## 10b. Two interfaces, one pipeline

Calder exposes **REST API** (modern applications, SDKs) and **SMTP** (`smtp.calder.com:587`, STARTTLS; project-scoped username + generated secret) for existing stacks and SMTP-native libraries (Nodemailer, smtplib, Laravel/Django mailers, etc.). Both converge into the same ingestion → queue → worker → provider pipeline: one email model, one event lifecycle, one usage meter, one billable event. SMTP is a standard-protocol interface, not a second delivery system. No anonymous relay, ever — authentication and TLS are mandatory. Full spec: `docs/SMTP.md`.

## 11. Pricing (hypothesis — NOT finalized)

| Plan    | Price (NGN)  | Target volume | USD equiv* |
| ------- | ------------ | ------------- | ---------- |
| Free    | ₦0           | 3,000/mo      | $0         |
| Builder | ≈ ₦3,500/mo  | ~25,000       | TBD        |
| Pro     | ≈ ₦7,500/mo  | ~75,000       | TBD        |
| Scale   | ≈ ₦20,000/mo | ~250,000      | TBD        |

Free includes Gmail connection, 1 domain, API + SMTP, templates, basic logs, 1 webhook. Higher tiers add domains, campaigns (post-MVP), webhooks, retention, analytics, teams.

\*USD equivalents unset — FX volatility makes premature dollar figures dishonest. NGN leads; USD follows at launch parity review.

Rules: hypotheses, not promises — no value is hardcoded anywhere except plan-configuration tables. Hard limits over overages. Unit-economics model required before commercial lock: see `docs/PRICING.md`.

## 12. Payments

Local-first, not local-only: NGN via Nigerian rails first, USD/international next. Provider abstraction stays clean enough for either; no Stripe-only assumptions, no speculative provider builds. Calder's billing system owns subscription state, updated via webhook — never the payment provider directly.

## 18. Transports & graduation (new)

Sending flows through per-project **transports** (`project_transports`): Gmail (OAuth-connected, capped, for development and small apps), SES, and future managed infrastructure. The API, keys, logs, templates, and events never change when the transport does — switching is configuration, not reintegration.

**Gmail Quickstart:** no domain required. OAuth (minimum `gmail.send` scope — never passwords), encrypted tokens, conservative daily caps, limits surfaced transparently. When the app grows, Calder prompts domain verification and graduates the project to production infrastructure.

**Campaigns vs transactional (architecture, not product yet):** transactional (OTP, receipts, resets, notifications) ships now. Campaigns (audiences, consent, unsubscribe, scheduling, batching, analytics) are an explicit future architecture — never "one send × 10,000". No bulk mail through Gmail, ever.

## 19. Abuse posture (new)

Per-account/project/transport limits, rate limiting, suppression, bounce/complaint tracking, throttling, suspension + revocation + audit trails. Gmail-connected accounts get the most conservative limits in the system. Calder must never become a spam relay — see `SECURITY.md` §14 and `ARCHITECTURE.md` §5b.

## 20. One-time purchases & credits (new)

Subscriptions aren't the only way to pay — critical where cards are scarce:

- **Email packs** (e.g. 10k sends, no expiry for 12 months): consumed after plan quota. Prepaid via bank transfer or card. The core NGN-friendly mechanic.
- **Domain slots** beyond plan limits, **extended log retention**, **priority support incidents** — small, legible, one-click.
- **Credits ledger** (specified, built with billing): purchase → ledger credit → consumed by metered sends → auditable. Never negative, never estimated; reconciliation identical to subscriptions.
- Never: ads in emails, selling data, throttling free into uselessness to force upgrades.

## 13. Design & brand direction

Calder's visual identity is a defined product requirement, not an afterthought — see `docs/DESIGN.md` for the full system ("Editorial Infrastructure": technical precision with restrained, cinematic art direction). Every page must have an articulable visual idea; "it's just a dashboard" is not an acceptable answer. Marketing surfaces are expressive/editorial; the dashboard is precise/dense/functional — same universe, different register.

## 14. Tooling philosophy

Prefer CLI tooling (GitHub CLI, Vercel CLI, database migration CLIs, etc.) over manual dashboard operations wherever one exists — see `AGENTS.md` § "CLI-first tooling" for the full rule set. This keeps operations scriptable, auditable, and reproducible, and matters especially for AI-agent-driven work.

## 15. North star metric

**Successful transactional communications delivered through Calder.** Key supporting metric: time to first successful delivery.

## 16. What we will NOT do

Immediately: build microservices everywhere, support every email provider, build SMS/push, build marketing automation, build a complex AI layer, add trendy dependencies without reason, expose internal services publicly, create documentation nobody reads, let AI agents invent architecture or visual style outside `docs/DESIGN.md`, optimize for imaginary scale.

## 17. Decision log

**Decided:** name (Calder; Avenor renamed — legacy `org_avenor`/`proj_website` seed IDs and `avenor_sk_` key verification retained for compat, see report), Nigeria-first wedge with global bar, developer-first positioning, transactional-first, email as first primitive, transport abstraction (Gmail → SES → managed), Gmail Quickstart via OAuth (never passwords), PostgreSQL, TypeScript, Next.js, Hono, Drizzle, Redis-compatible infra, Lenis for smooth scroll, queue-based delivery, provider abstraction, AWS SES as initial provider, NGN-first pricing hypothesis, local-first billing abstraction, monorepo, compact doc strategy, AGENTS.md doc-evolution rule, "Editorial Infrastructure" design direction, CLI-first tooling philosophy, production-first engineering philosophy.

**Not yet locked:** primary domain, final hosting providers, queue/Redis provider, final Bachs integration, final pricing (see `docs/PRICING.md` gate), exact Vercel verification mechanism, first SDK release date, OTP in-MVP-or-not, exact failover strategy, SMTP gateway deploy topology (see ADR-014), managed TCP-LB provider, attachment caps, `X-Calder-*` header set, port 465 on day one.

**Explicitly not the product:** automating personal Gmail SMTP accounts outside our OAuth flow; bulk campaigns through Gmail; "Resend, but cheaper" as an identity (useful internally, never the headline).
