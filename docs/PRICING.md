# Calder Pricing, Architecture & Unit Economics Gate

Status: **locked for public launch (2026-09-14)**. Public surfaces read from
`apps/web/lib/plans.ts`; this document says why, and what still gates changes.
See `docs/DECISIONS.md` ADR-024 for the decision record.

## 1. The model

| | Beginner | Pro | Premium | Scale |
| --- | ---: | ---: | ---: | ---: |
| Price | **$0 / ₦0** | **$15 / ₦25,000** | **$49 / ₦75,000** | **Custom** |
| Emails / month | 5,000 | 50,000 | 250,000 | Custom |
| Projects | 3 | 10 | 50 | Custom |
| Domains | 2 | 10 | 50 | Custom |
| Team members | 1 | 5 | 15 | Custom |
| Environments | Development | Dev + Staging + Production | Dev + Staging + Production | Custom |
| Log retention | 7 days | 30 days | 90 days | Custom |
| Support | Community | Email | Priority | Dedicated |

Marketing allowances (contacts, not sends): 1,000 / 10,000 / 50,000 / Custom.

**Positioning rule.** The tiers are not a volume ladder. They are a capability
ladder, and every public surface must read that way:

```
Beginner → I can build.
Pro      → I can ship.
Premium  → I can operate.
Scale    → I can depend on this.
```

Concretely: Beginner is a real plan (API, SMTP, templates, logs, webhooks,
analytics at a small scale) because the developer who evaluates Calder must not
need a card to find out whether it works. Premium is won on control,
deliverability and observability, not on "more emails". Scale has no arbitrary
ceiling; it is sold as dedicated capacity, SLA and architecture.

## 2. Currency rules

- ₦ and $ figures are **two separate price points**, not an FX conversion. A
  Nigerian customer pays the naira price regardless of what the dollar is doing;
  the US customer pays the dollar price. Both are shown honestly on the pricing
  page, and the currency toggle never implies a rate.
- The naira price exists for the local market's advantage (local rails, lower
  card friction, price stability); the dollar price exists for everyone else.
- Reprice triggers are calendar-reviewed quarterly: sustained NGN/USD drift
  (>15%), SES price change, or a material shift in the unit-economics model
  below.

## 3. Marketing allowances, and why they are separate

Transactional (OTPs, resets, receipts, invoices, security alerts, order updates)
and marketing (newsletters, launches, promotions, lifecycle) travel the same
pipeline but never the same reputation: separate suppression, separate consent,
separate rate limits, separate allowance.

- Marketing allowances are counted in **contacts**, so a large list never eats
  the transactional quota that keeps logins working.
- Conversely, campaign volume never inflates the transactional bill.
- The marketing suite (campaigns, audiences, segments, automations, preference
  center) is included in **every plan, including Beginner**. It is marked
  "in development" on public surfaces until it ships; that label is removed in
  the same commit that ships it (`apps/web/lib/site.ts` → `MARKETING_SUITE`).

## 4. Unit-economics model (still the gate for any change)

Per-email fully-loaded cost = sum of:

| Cost line | Driver | Notes |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Provider delivery | SES $/1k by region + data transfer | Gmail transports cost ~$0 infra but cap volume |
| Database | rows/email (email + events + idempotency) × retention × managed-PG $/GB | events dominate; retention policy is a cost lever |
| Queue/Redis | jobs + retries × managed-Redis $ | retries multiply cost, backoff design matters |
| Logs | bytes/log-line × volume × retention | structured but sampled at scale |
| Event storage | webhook attempts × payload × retention | attempt history is a feature with a bill |
| Bandwidth | message + attachment bytes × egress $ | attachment caps are pricing policy |
| Webhook delivery | attempts × egress | customer endpoints being slow costs us |
| Abuse/fraud | review ops + provider penalties + suspended capacity | Gmail path carries highest risk weight |
| Support | tickets/1k users by tier | free tier must be near-zero-touch |
| Payments | NGN rails % + fixed, USD rail % + fixed, failed-payment retries | local-first means local fee structures |
| FX & volatility | NGN/USD drift between price-set and settlement | reprice trigger: >15% sustained drift |
| VAT/taxes | Nigerian VAT where applicable | price display must state tax treatment |
| Margin | target contribution per tier | free tier is CAC, must convert or stay cheap |

**Gate rule:** a plan (or a pricing change) does not ship until modelled
contribution margin ≥ target under p95 usage of that tier's quota, including a
10% abuse overhead assumption on free Gmail-heavy cohorts. Marketing allowances
are modelled separately: contacts cost storage and support, not delivery.

## 5. Guardrails (enforced in code, not policy docs)

- Hard limits, no silent overages. Quota exhaustion → `PLAN_LIMIT_REACHED` with
  limit, usage and reset time. Nothing is charged without an explicit choice.
- Test-key traffic is never metered. Retries and idempotent replays never
  double-count. Webhook deliveries and API reads are never billed.
- Beginner is capped and abuse-monitored; the free tier stays generous but
  cannot become a spam path (see `SECURITY.md` §14).
- One meter for the platform: subscriptions and prepaid credit packs both feed
  the same aggregation (ADR-020).

## 6. Open items

- Payment provider integration (Bachs) validation before paid plans are
  chargeable; until then Pro/Premium are listed with their real prices and the
  checkout path is the billing work in progress.
- Annual billing, and VAT display treatment on the pricing page.
- Marketing allowance enforcement once campaigns ship (contact counting and
  consent state are the same meter question, tracked in the roadmap).
