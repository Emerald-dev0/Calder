# Calder Pricing, Architecture & Unit Economics Gate

Status: hypothesis. NOTHING HERE IS A PROMISE until the model below clears.
See PRD §11 for current numbers, ADR-019 for the decision.

## 1. Plan configuration (not hardcoded values)

Plans live in `plans` / `plan_prices` tables (NGN now, USD at parity review).
Code references tiers (`free`, `builder`, `pro`, `scale`), never amounts.
Changing a price is a database row + changelog entry, not a deploy.

## 2. Unit-economics model (required before commercial lock)

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

**Gate rule:** no plan goes live until modeled contribution margin ≥ target
(set at pricing review) under p95 usage of that tier's quota, including a
10% abuse overhead assumption on free Gmail-heavy cohorts.

## 3. Guardrails (enforced in code, not policy docs)

- Hard limits, no overages in MVP. Quota exhaustion → clear error, upgrade path.
- Test-key traffic never metered. Retries and idempotent replays never double-count.
- Free tier: Gmail-transport default, strictest caps, tightest abuse monitoring.
- Reprice triggers (FX drift, SES price change) are calendar-reviewed quarterly.

## 4. One-time purchases & credits ledger (specified)

For card-scarce markets, subscriptions can't be the only way to pay:

- **Email packs** (e.g. 10k sends, 12-month expiry): consumed after plan quota.
 Prepaid by bank transfer or card, no subscription required.
- **Domain slots, extended retention, priority support**, one-click add-ons.
- **Ledger spec** (build with billing, not before): `credit_ledger`
 `(id, organization_id, type[pack|slot|retention|support], quantity_total,
quantity_used, purchased_at, expires_at)` + `credit_consumption`
 `(id, ledger_id, email_id, consumed_at)`. Consumption joins the same
 aggregation cron as subscriptions, one meter, two funding sources.
 Ledger never goes negative; expiry sweeps are idempotent cron.
- Forbidden revenue: ads in emails, selling data, degrading free to force upgrades.

## 5. Open pricing questions

USD equivalents and exact kobo/cent values; Builder/Pro/Scale quota confirmation
against the model; overage-vs-hard-limit posture post-MVP; annual billing.
