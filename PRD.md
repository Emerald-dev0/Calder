# Calder, Product Requirements Document (v0.2)

Status: Pre-launch. Rebrand (Avenor → Calder) + transport architecture adopted.
Category: Developer infrastructure / application communication
Primitives: Transactional email (live) + marketing email (in development)

## 1. Summary

Calder is developer-first communication infrastructure, starting with transactional email and designed to expand into a broader communication layer (OTP, SMS, push) without architectural rework.

Positioning: **Calder, email infrastructure for applications.** Transactional mail (OTPs, resets, receipts, alerts) and marketing mail (campaigns, lifecycle) on two streams over one pipeline, one API, one event log. Differentiation comes from developer experience + domain intelligence + debuggability + separate-stream reputation + two locally-priced currencies + distinctive design, combined, not any single feature.

## 2. Problem

Developers need application-generated transactional communication but implementing it well means handling providers, DNS/SPF/DKIM/DMARC, templates, queues, retries, webhooks, suppression, and billing, usually fragmented. Calder turns this into one coherent developer experience.

## 3. Users

**Targeting:** indie developers, startups, SaaS companies, engineering teams, plus junior developers and teams with existing SMTP-based stacks (WordPress, Laravel, Django, legacy systems) who need infrastructure without replatforming.

**First market, not ceiling:** Nigeria-first, NGN pricing, local payment rails, onboarding that assumes no domain and no budget. The product must never look geographically limited: same API, same reliability bar, global ambition. Nigeria is the wedge (accessible pricing, Gmail-first beginners, underserved builders), not the boundary.

**Not targeting:** CRM, sales engagement, or a drag-and-drop page builder. Marketing email *is* in scope from 2026-09-14 (ADR-025), as a second stream over the same pipeline, not a separate product sold separately.

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

Templates (+ playground: pick welcome/OTP/receipt → preview → test → publish → copy code), OTP infrastructure, advanced analytics, scheduling, batch sending, suppression management UI, domain health dashboard, Vercel hosted-domain verification, additional SDKs, campaign architecture (audiences, consent, scheduling, designed, not built; see §18), automations (event → condition → delay → email; priced separately), inbound email (user → Calder → app webhook), CLI (`calder doctor` diagnostics first), MCP server for coding agents, migration assistant (Resend/Postmark mapping guides + codemod, guides, never API cloning), Email Debugger (per-email trace view), "why didn't it arrive" explainer.

## 7. Later

Multi-provider failover, advanced deliverability tooling, dedicated IPs, roles/SSO, regional infrastructure, enterprise controls.

## 8. Distinctive feature: hosted-project domain verification

Verifying a developer controls a `*.vercel.app` project doesn't by itself satisfy SPF/DKIM/DMARC on a zone they don't control. **Open problem**, see `docs/DECISIONS.md` ADR-005. Candidate resolution: send via an Calder-managed subdomain mapped to the verified project rather than literally sending "from" the platform-hosted address.

## 9. OTP infrastructure, status undecided (MVP vs. immediately post-MVP)

Email-based OTP: create/verify challenge, expiration, attempt limits, replay prevention, rate limiting, audit events.

## 10. API conventions

Versioned from first release (`/v1/...`). Predictable error shape: `{ error: { code, message, request_id } }`. API keys: `test`/`live`, hashed at rest, prefixed, revocable, rotatable.

## 10b. Two interfaces, one pipeline

Calder exposes **REST API** (modern applications, SDKs) and **SMTP** (`smtp.calder.com:587`, STARTTLS; project-scoped username + generated secret) for existing stacks and SMTP-native libraries (Nodemailer, smtplib, Laravel/Django mailers, etc.). Both converge into the same ingestion → queue → worker → provider pipeline: one email model, one event lifecycle, one usage meter, one billable event. SMTP is a standard-protocol interface, not a second delivery system. No anonymous relay, ever, authentication and TLS are mandatory. Full spec: `docs/SMTP.md`.

## 11. Pricing (locked for launch, 2026-09-14)

| Plan | USD | NGN | Emails / month | Projects | Domains | Team | Environments | Logs | Support |
| -------- | ----- | --------- | -------------- | -------- | ------- | ---- | ---------------------------- | ------- | --------- |
| Beginner | $0 | ₦0 | 5,000 | 3 | 2 | 1 | Development | 7 days | Community |
| Pro | $15 | ₦25,000 | 50,000 | 10 | 10 | 5 | Dev + Staging + Production | 30 days | Email |
| Premium | $49 | ₦75,000 | 250,000 | 50 | 50 | 15 | Dev + Staging + Production | 90 days | Priority |
| Scale | Custom | Custom | Custom | Custom | Custom | Custom | Custom | Custom | Dedicated |

Marketing allowances, counted in **contacts** and separate from transactional
send volume: 1,000 / 10,000 / 50,000 / Custom. The marketing suite (campaigns,
audiences, segments, automations, preference center, transaction/marketing
stream separation) is included in **every plan including Beginner**, and is
labeled "in development" on public surfaces until it ships.

Rules (unchanged, and now enforced by ADR-024):
- Naira and dollar figures are separate local price points, never an FX
  conversion. Hard limits over overages.
- `apps/web/lib/plans.ts` is the single public source of truth; the pricing page,
  comparison tables, FAQ and structured data read from it.
- The unit-economics gate in `docs/PRICING.md` §4 applies to any change to this
  table, including marketing allowances.
- No value may be hardcoded anywhere outside plan-configuration tables and that
  file.

## 12. Payments

Local-first, not local-only: NGN via Nigerian rails first, USD/international next. Provider abstraction stays clean enough for either; no Stripe-only assumptions, no speculative provider builds. Calder's billing system owns subscription state, updated via webhook, never the payment provider directly.

## 18. Transports & graduation (new)

Sending flows through per-project **transports** (`project_transports`): Gmail (OAuth-connected, capped, for development and small apps), SES, and future managed infrastructure. The API, keys, logs, templates, and events never change when the transport does, switching is configuration, not reintegration.

**Gmail Quickstart:** no domain required. OAuth (minimum `gmail.send` scope, never passwords), encrypted tokens, conservative daily caps, limits surfaced transparently. When the app grows, Calder prompts domain verification and graduates the project to production infrastructure.

**Campaigns vs transactional (two streams, one pipeline):** transactional (OTP, receipts, resets, notifications) is live. Marketing (audiences, consent, unsubscribe, scheduling, batching, analytics) is in development on the same pipeline with its own suppression, consent, rate limits and contact allowance, never "one send × 10,000", and never sharing reputation with application mail. No bulk mail through Gmail, ever. See ADR-025.

## 19. Abuse posture (new)

Per-account/project/transport limits, rate limiting, suppression, bounce/complaint tracking, throttling, suspension + revocation + audit trails. Gmail-connected accounts get the most conservative limits in the system. Calder must never become a spam relay, see `SECURITY.md` §14 and `ARCHITECTURE.md` §5b.

## 20. One-time purchases & credits (new)

Subscriptions aren't the only way to pay, critical where cards are scarce:

- **Email packs** (e.g. 10k sends, no expiry for 12 months): consumed after plan quota. Prepaid via bank transfer or card. The core NGN-friendly mechanic.
- **Domain slots** beyond plan limits, **extended log retention**, **priority support incidents**, small, legible, one-click.
- **Credits ledger** (specified, built with billing): purchase → ledger credit → consumed by metered sends → auditable. Never negative, never estimated; reconciliation identical to subscriptions.
- Never: ads in emails, selling data, throttling free into uselessness to force upgrades.

## 13. Design & brand direction

Calder's visual identity is a defined product requirement, not an afterthought, see `docs/DESIGN.md` for the full system ("Editorial Infrastructure": technical precision with restrained, cinematic art direction). Every page must have an articulable visual idea; "it's just a dashboard" is not an acceptable answer. Marketing surfaces are expressive/editorial; the dashboard is precise/dense/functional, same universe, different register.

## 14. Tooling philosophy

Prefer CLI tooling (GitHub CLI, Vercel CLI, database migration CLIs, etc.) over manual dashboard operations wherever one exists, see `AGENTS.md` § "CLI-first tooling" for the full rule set. This keeps operations scriptable, auditable, and reproducible, and matters especially for AI-agent-driven work.

## 15. North star metric

**Successful transactional communications delivered through Calder.** Key supporting metric: time to first successful delivery.

## 16. What we will NOT do

Immediately: build microservices everywhere, support every email provider, build SMS/push, build marketing automation, build a complex AI layer, add trendy dependencies without reason, expose internal services publicly, create documentation nobody reads, let AI agents invent architecture or visual style outside `docs/DESIGN.md`, optimize for imaginary scale.

## 17. Decision log

**Decided:** name (Calder; Avenor renamed, legacy `org_avenor`/`proj_website` seed IDs and `avenor_sk_` key verification retained for compat, see report), Nigeria-first wedge with global bar, developer-first positioning, transactional-first, email as first primitive, transport abstraction (Gmail → SES → managed), Gmail Quickstart via OAuth (never passwords), PostgreSQL, TypeScript, Next.js, Hono, Drizzle, Redis-compatible infra, Lenis for smooth scroll, queue-based delivery, provider abstraction, AWS SES as initial provider, NGN-first pricing hypothesis, local-first billing abstraction, monorepo, compact doc strategy, AGENTS.md doc-evolution rule, "Editorial Infrastructure" design direction, CLI-first tooling philosophy, production-first engineering philosophy.

**Not yet locked:** primary domain, final hosting providers, queue/Redis provider, final Bachs integration, final pricing (see `docs/PRICING.md` gate), exact Vercel verification mechanism, first SDK release date, OTP in-MVP-or-not, exact failover strategy, SMTP gateway deploy topology (see ADR-014), managed TCP-LB provider, attachment caps, `X-Calder-*` header set, port 465 on day one.

**Explicitly not the product:** automating personal Gmail SMTP accounts outside our OAuth flow; bulk campaigns through Gmail; "Resend, but cheaper" as an identity (useful internally, never the headline).
