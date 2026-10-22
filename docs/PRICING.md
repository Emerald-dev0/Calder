# Calder Pricing, Architecture & Unit Economics Gate

Status: **revised 2026-10-22** (five-tier catalogue). The catalogue itself lives
in `packages/config/src/plan-limits.ts` — limits, prices and display names — and
every surface reads from there: the dashboard, the API's quota errors, the
marketing site (`apps/web/lib/plans.ts` is a projection of it) and the database
seed. See `docs/DECISIONS.md` ADR-024 for the original decision and ADR-045 for
this revision.

## 1. The model

|                  |     Beginner |      Starter |           Pro |        Premium |      Scale |
| ---------------- | -----------: | -----------: | ------------: | -------------: | ---------: |
| Price            | **$0 / ₦0** | **$5 / ₦5,000** | **$18 / ₦20,000** | **$65 / ₦75,000** | **Custom** |
| Emails / month   |        5,000 |       10,000 |        50,000 |        250,000 |     Custom |
| Projects         |            3 |            3 |            10 |             50 |     Custom |
| Domains          |            2 |            3 |            10 |             50 |     Custom |
| Sender identities|            5 |           10 |            25 |            100 |     Custom |
| Team seats       |            1 |            2 |             5 |             15 |     Custom |
| Environments     |  Development |       TBD ‡ | Dev + Staging + Production | Dev + Staging + Production |     Custom |
| Log retention    |       7 days |      14 days |       30 days |        90 days |     Custom |
| Support          |    Community |        Email |         Email |       Priority |  Dedicated |

‡ Starter's environment matrix is not decided yet. It is recorded as unset and
is enforced nowhere; the pricing-page pass will settle it.

Marketing allowances (contacts, not sends): 1,000 / 10,000 / 50,000 / Custom.
**Unapproved draft** — carried in config as `contacts` with `approved: false`,
never rendered in the Usage UI, not enforced.

### What is enforced, and when

Only **projects, domains, sender identities and team seats** are enforced, and
only when a resource is created. Existing resources are grandfathered: nothing
is deleted or disabled because a plan changed. A refusal carries
`plan_limit_reached`, the limit, the current count and an upgrade pointer that
skips any tier which would not actually raise that ceiling.

Recorded but **not enforced yet**: log retention, Gmail sender allowance
(2 everywhere) and Beginner's 500-email daily cap. They live in config so the
phases that build them have one place to read.

Usage warnings are computed from the allowance at 50% and 80% — 2,500 / 4,000
on Beginner, 5,000 / 8,000 on Starter, 25,000 / 40,000 on Pro and 125,000 /
200,000 on Premium. No per-plan threshold is ever typed by hand.

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

| Cost line         | Driver                                                                  | Notes                                             |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Provider delivery | SES $/1k by region + data transfer                                      | Gmail transports cost ~$0 infra but cap volume    |
| Database          | rows/email (email + events + idempotency) × retention × managed-PG $/GB | events dominate; retention policy is a cost lever |
| Queue/Redis       | jobs + retries × managed-Redis $                                        | retries multiply cost, backoff design matters     |
| Logs              | bytes/log-line × volume × retention                                     | structured but sampled at scale                   |
| Event storage     | webhook attempts × payload × retention                                  | attempt history is a feature with a bill          |
| Bandwidth         | message + attachment bytes × egress $                                   | attachment caps are pricing policy                |
| Webhook delivery  | attempts × egress                                                       | customer endpoints being slow costs us            |
| Abuse/fraud       | review ops + provider penalties + suspended capacity                    | Gmail path carries highest risk weight            |
| Support           | tickets/1k users by tier                                                | free tier must be near-zero-touch                 |
| Payments          | NGN rails % + fixed, USD rail % + fixed, failed-payment retries         | local-first means local fee structures            |
| FX & volatility   | NGN/USD drift between price-set and settlement                          | reprice trigger: >15% sustained drift             |
| VAT/taxes         | Nigerian VAT where applicable                                           | price display must state tax treatment            |
| Margin            | target contribution per tier                                            | free tier is CAC, must convert or stay cheap      |

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

### §5a. What "enforced in code" concretely means (Phase 2, ADR-036)

- The limit response is HTTP 402, error code `plan_limit_reached`, on every
  ingest path (`/v1/emails`, `/v1/emails/batch`, scheduled sends, and the
  dashboard composer gate). Details carry `limit`, `usage`, `tier`,
  `periodStart` and `periodEnd`; `fix` names the upgrade route.
- The counted quantity is _accepted live sends in the current period_
  (queued mail counts — you cannot burst past the cap while it lands); the
  billed quantity is _provider-accepted sends_ written to the usage ledger
  exactly once per email (`ur_<emailId>`). Throttle and invoice deliberately
  come from different tables.
- The period is the subscription's stamped cycle when one exists
  (anniversary-preserving rollover), else the current UTC calendar month.
- Test-key sends stamp `env='test'` at ingest, deliver only through the mock
  provider (`transport:'mock'` on the record is the auditable proof), and
  are excluded from every count in this file.
- Plan ceilings: 5,000 / 50,000 / 250,000 / custom (Scale). The single
  machine-readable copy is `PLAN_LIMITS` in `@calder/config`; anything else
  quoting a number is a bug.

## 6. Open items

- Payment provider integration (Bachs) validation before paid plans are
  chargeable; until then Pro/Premium are listed with their real prices and the
  checkout path is the billing work in progress.
- Annual billing, and VAT display treatment on the pricing page.
- Marketing allowance enforcement once campaigns ship (contact counting and
  consent state are the same meter question, tracked in the roadmap).

## Follow-ups this revision deliberately leaves open

1. **`premium` in `plan_tier`.** The enum is `free | starter | pro | scale`.
   Nothing can store a Premium subscription yet. The migration belongs to the
   billing phase, alongside the checkout that would write it; it is additive
   (`ALTER TYPE plan_tier ADD VALUE 'premium'`), and its rollback is "recreate
   the type without the value", which requires no rows to use it.
2. **Existing subscriptions.** Tier keys did not move, so a workspace on
   `starter` now reads Starter's allowance (10,000) rather than the old
   catalogue's 50,000, and one on `pro` reads Pro's (50,000) rather than
   250,000. Nobody's resources are touched, but their monthly ceiling changes at
   the next period. Remapping or grandfathered quotas is a commercial decision
   for the billing phase; see the phase report.
3. **Starter on the marketing page.** `apps/web` still renders four cards, so
   Starter (₦5,000/$5) is sellable in config but absent from `/pricing`. Adding
   it is a pricing-page change, explicitly out of scope here.
4. **Starter's environments.** Unset above; it is enforced nowhere today.

