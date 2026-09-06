# Avenor — Product Requirements Document (v0.1)

Status: Pre-development
Category: Developer infrastructure / transactional communication
Initial primitive: Transactional email

## 1. Summary

Avenor is developer-first communication infrastructure, starting with transactional email and designed to expand into a broader communication layer (OTP, SMS, push) without architectural rework.

Positioning: **Avenor — the easiest way to add reliable transactional email to an application.** Communication infrastructure that gets out of your way. Differentiation comes from developer experience + domain intelligence + debuggability + predictable pricing + distinctive design, combined — not any single feature.

## 2. Problem

Developers need application-generated transactional communication but implementing it well means handling providers, DNS/SPF/DKIM/DMARC, templates, queues, retries, webhooks, suppression, and billing — usually fragmented. Avenor turns this into one coherent developer experience.

## 3. Users

**Targeting:** indie developers, startups, SaaS companies, engineering teams — plus junior developers and teams with existing SMTP-based stacks (WordPress, Laravel, Django, legacy systems) who need infrastructure without replatforming.

**Not targeting (initially):** newsletter platforms, marketing automation, CRM, bulk/broadcast email.

## 4. Core model

```
Organization (billing/ownership boundary)
  └── Projects (app/environment separation)
        ├── API Keys (test/live)
        ├── Domains
        ├── Templates
        └── Emails → Events
```

## 5. Core modules (MVP scope)

Email API, **SMTP gateway (same pipeline, project-scoped credentials)**, domain verification (DNS-based), async queue + worker, provider abstraction (SES first), retries with backoff, idempotency, full email event lifecycle, signed/retried webhooks, usage metering from authoritative records, basic dashboard, Bachs billing integration.

## 6. Post-MVP

Templates, OTP infrastructure, advanced analytics, scheduling, batch sending, suppression management UI, domain health dashboard, Vercel hosted-domain verification, additional SDKs.

## 7. Later

Multi-provider failover, advanced deliverability tooling, dedicated IPs, roles/SSO, regional infrastructure, enterprise controls.

## 8. Distinctive feature: hosted-project domain verification

Verifying a developer controls a `*.vercel.app` project doesn't by itself satisfy SPF/DKIM/DMARC on a zone they don't control. **Open problem** — see `docs/DECISIONS.md` ADR-005. Candidate resolution: send via an Avenor-managed subdomain mapped to the verified project rather than literally sending "from" the platform-hosted address.

## 9. OTP infrastructure — status undecided (MVP vs. immediately post-MVP)

Email-based OTP: create/verify challenge, expiration, attempt limits, replay prevention, rate limiting, audit events.

## 10. API conventions

Versioned from first release (`/v1/...`). Predictable error shape: `{ error: { code, message, request_id } }`. API keys: `test`/`live`, hashed at rest, prefixed, revocable, rotatable.

## 10b. Two interfaces, one pipeline

Avenor exposes **REST API** (modern applications, SDKs) and **SMTP** (`smtp.avenor.email:587`, STARTTLS; project-scoped username + generated secret) for existing stacks and SMTP-native libraries (Nodemailer, smtplib, Laravel/Django mailers, etc.). Both converge into the same ingestion → queue → worker → provider pipeline: one email model, one event lifecycle, one usage meter, one billable event. SMTP is a standard-protocol interface, not a second delivery system. No anonymous relay, ever — authentication and TLS are mandatory. Full spec: `docs/SMTP.md`.

## 11. Pricing (initial hypothesis)

| Plan    | Price            | Emails   |
| ------- | ---------------- | -------- |
| Free    | ₦0 / $0          | 3,000/mo |
| Starter | ₦5,000 / $7 mo   | 25,000   |
| Pro     | ₦12,000 / $15 mo | 100,000  |
| Scale   | ₦45,000 / $50 mo | 500,000  |

NGN + USD at launch. Default posture: predictable pricing over overages — hard limits vs. opt-in overages still open.

## 12. Payments

Bachs is the initial candidate, pending validation. Avenor's billing system owns subscription state, updated via webhook — never the payment provider directly.

## 13. Design & brand direction

Avenor's visual identity is a defined product requirement, not an afterthought — see `docs/DESIGN.md` for the full system ("Editorial Infrastructure": technical precision with restrained, cinematic art direction). Every page must have an articulable visual idea; "it's just a dashboard" is not an acceptable answer. Marketing surfaces are expressive/editorial; the dashboard is precise/dense/functional — same universe, different register.

## 14. Tooling philosophy

Prefer CLI tooling (GitHub CLI, Vercel CLI, database migration CLIs, etc.) over manual dashboard operations wherever one exists — see `AGENTS.md` § "CLI-first tooling" for the full rule set. This keeps operations scriptable, auditable, and reproducible, and matters especially for AI-agent-driven work.

## 15. North star metric

**Successful transactional communications delivered through Avenor.** Key supporting metric: time to first successful delivery.

## 16. What we will NOT do

Immediately: build microservices everywhere, support every email provider, build SMS/push, build marketing automation, build a complex AI layer, add trendy dependencies without reason, expose internal services publicly, create documentation nobody reads, let AI agents invent architecture or visual style outside `docs/DESIGN.md`, optimize for imaginary scale.

## 17. Decision log

**Decided:** name (Avenor), developer-first positioning, transactional-first, email as first primitive, PostgreSQL, TypeScript, Next.js, Hono, Drizzle, Redis-compatible infra, Lenis for smooth scroll, queue-based delivery, provider abstraction, AWS SES as initial provider, NGN+USD pricing, Bachs as initial payment candidate, monorepo, compact doc strategy, AGENTS.md, "Editorial Infrastructure" design direction, CLI-first tooling philosophy, production-first engineering philosophy.

**Not yet locked:** primary domain, exact accent color values, final hosting providers, queue/Redis provider, final Bachs integration, final pricing, exact Vercel verification mechanism, first SDK release date, OTP in-MVP-or-not, exact failover strategy, SMTP gateway deploy topology (see ADR-014).

**Explicitly not the product:** automating personal Gmail SMTP accounts. Avenor replaces self-operated email infrastructure; it does not script around consumer mailboxes.
