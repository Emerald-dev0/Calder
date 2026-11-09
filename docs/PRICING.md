# Calder Pricing, Architecture & Unit Economics Gate

> Round-4 status (2026-11-08): commercial pricing is **USD only**. Checkout runs
> through Paystack; paid checkout stays disabled unless the merchant account has
> USD enabled (`PAYSTACK_USD_ENABLED=true`) and plan codes are configured. The
> catalogue in `packages/config/src/plan-limits.ts` and `credits.ts` is the
> single source of every limit and price. See [BILLING.md](BILLING.md),
> [CREDITS.md](CREDITS.md), [PAYSTACK.md](PAYSTACK.md) and
> [API-LIMITS.md](API-LIMITS.md).

Status: **revised 2026-11-08** (three commercial plans; Premium and Scale
retired). The catalogue itself lives
in `packages/config/src/plan-limits.ts` — limits, prices and display names — and
every surface reads from there: the dashboard, the API's quota errors, the
marketing site (`apps/web/lib/plans.ts` is a projection of it) and the database
seed. See `docs/DECISIONS.md` ADR-024 for the original decision, ADR-045 for the
five-tier revision, and **ADR-057** for the retirement of Premium and Scale.

## 1. The model

|                   |  Beginner | Starter |     Pro |
| ----------------- | --------: | ------: | ------: |
| Price (USD)       |    **$0** |  **$5** | **$18** |
| Emails / month    |     5,000 |  10,000 |  50,000 |
| Submissions / day |       500 |   2,000 |   5,000 |
| Projects          |         3 |       3 |      10 |
| Domains           |         2 |       3 |      10 |
| Sender identities |         5 |      10 |      25 |
| Team seats        |         1 |       2 |       5 |
| Support           | Community |   Email |   Email |

Premium (250,000) and Scale (custom) are **retired from the commercial
offering**. Their catalogue entries and database enum values are retained so
existing subscriptions keep resolving to their real limits; they are not sold,
not shown on `/pricing`, and cannot be assigned through any workflow. See §6.

Not claimed on any plan, because nothing enforces it: log retention periods,
per-plan environments, tier-restricted key scopes, or webhook replay as a paid
feature. Scoped keys, webhook replay and audit logs work on every plan today.

Marketing allowances (contacts, not sends): 1,000 / 10,000 / 50,000 / Custom.
**Unapproved draft** — carried in config as `contacts` with `approved: false`,
never rendered in the Usage UI, not enforced.

Marketing itself is **not part of this release**. The suite is no longer
described as "in development and included"; every public column, the dashboard
and the API state Coming Soon. Broadcast and audience endpoints return
`403 feature_not_available`, and their dashboard destinations are disabled.

### What is enforced, and when

**Projects, domains, sender identities and team seats** are enforced
when a resource is created. Existing resources are grandfathered: nothing
is deleted or disabled because a plan changed. A refusal carries
`plan_limit_reached`, the limit, the current count and an upgrade pointer that
skips any tier which would not actually raise that ceiling.

Beginner also has an enforced limit of 500 accepted live emails per organization
per UTC day, alongside the 5,000-per-billing-period ceiling. Queued and failed
emails count once accepted; test-key traffic does not. All projects and sending
routes share this limit; connected Gmail has additional account-level limits.
Recorded but not enforced: log retention and Gmail sender count.

Usage warnings are computed from the allowance at 50% and 80% — 2,500 / 4,000
on Beginner, 5,000 / 8,000 on Starter and 25,000 / 40,000 on Pro. A grandfathered
Premium subscription keeps its 125,000 / 200,000 thresholds. No per-plan
threshold is ever typed by hand.

**Positioning rule.** The tiers are not a volume ladder. They are a capability
ladder, and every public surface must read that way:

```
Beginner → I can build.
Starter  → I can grow.
Pro      → I can ship.
```

Concretely: Beginner is a real plan (API, templates, logs, webhooks, analytics
at a small scale) because the developer who evaluates Calder must not need a
card to find out whether it works. Starter raises the ceiling for a project
that has outgrown it. Pro is the top plan: higher volume and resource limits,
same product. There is no "contact us" tier while Premium and Scale are
retired, so the upgrade pointer stops at Pro and says so.

## 2. Currency rules

- **Public pricing is USD only** (Round 4). The NGN figures retained in the
  catalogue are historical/owner-held data and are not shown or charged. A
  naira price would be a separate price point, not an FX conversion;
  the US customer pays the dollar price. Both are shown honestly on the pricing
  page, and the currency toggle never implies a rate.
- The naira price exists for the local market's advantage (local rails, lower
  card friction, price stability); the dollar price exists for everyone else.
- Reprice triggers are calendar-reviewed quarterly: sustained NGN/USD drift
  (>15%), SES price change, or a material shift in the unit-economics model
  below.

## 2a. Payment processor fees (Bachs, verified 2026-10-22)

Billing is not built yet. These are the verified standard fees, recorded so the
margin model in §4 uses real numbers when the Bachs phase starts:

| Rail                      | Fee                       |
| ------------------------- | ------------------------- |
| NGN direct bank transfer  | 1.5%, capped at ₦2,000    |
| NGN virtual accounts      | 1.0%, capped at ₦300–₦500 |
| NGN local cards           | 2.0%                      |
| USD / international cards | 5.0% + $0.40              |

Two consequences worth remembering: a ₦5,000 Starter payment nets at most
₦4,925 before provider and infra costs, and the $5 Starter payment loses 5% plus
40¢ — 13% — before anything else. Starter is therefore a volume-and-conversion
tier, not a margin tier, and the ₦2,000 cap makes annual/larger NGN payments
cheaper per naira than many small ones.

## 3. Marketing allowances, and why they are separate

Transactional (OTPs, resets, receipts, invoices, security alerts, order updates)
and marketing (newsletters, launches, promotions, lifecycle) travel the same
pipeline but never the same reputation: separate suppression, separate consent,
separate rate limits, separate allowance.

- Marketing allowances are counted in **contacts**, so a large list never eats
  the transactional quota that keeps logins working.
- Conversely, campaign volume never inflates the transactional bill.
- The marketing suite (campaigns, audiences, segments, automations, preference
  center) is **planned for every plan, including Beginner**, and is excluded
  from this release. Public surfaces, the dashboard and the API all say Coming
  Soon; the marketing API is disabled server-side. That status changes only with
  a product launch decision and campaign acceptance evidence
  (`apps/web/lib/site.ts` → `MARKETING_SUITE`, `packages/config/src/features.ts`).

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
- Plan ceilings: 5,000 / 10,000 / 50,000 for the three commercial plans; the
  retired Premium (250,000) and Scale (custom) values remain resolvable. The single
  machine-readable copy is `PLAN_LIMITS` in `@calder/config`; anything else
  quoting a number is a bug.

## 6. Open items

- Payment provider integration (Bachs) validation before paid plans are
  chargeable; until then Starter and Pro are listed with their planned prices
  and the checkout path is the billing work in progress.
- Annual billing, and VAT display treatment on the pricing page.
- Marketing allowance enforcement once campaigns ship (contact counting and
  consent state are the same meter question, tracked in the roadmap).

## Follow-ups this revision deliberately leaves open

1. **Retirement, not deletion — resolved 2026-11-08.** Premium and Scale stay in
   `plan_tier` and in `PLAN_LIMITS` with `retired: true`. The seed only inserts
   Beginner, Starter and Pro (`onConflictDoNothing`), so historical rows and
   subscriptions survive and `resolveOrgTier` still returns the real tier.
   `assertAssignableTier` rejects `premium`, `scale` and unknown strings before
   any write, in both the admin API (`400 plan_not_assignable`) and the
   control-plane grant action. `upgradeTierFor` never points at a retired tier.
2. **Existing subscriptions.** Starter and Pro keep their current catalogue
   values (10,000 and 50,000). Existing Premium (250,000) and Scale (custom)
   organizations are not downgraded, not migrated and not re-priced by this
   change; they are displayed as "Premium (retired)" / "Scale (retired)" and
   keep their limits. Any future remapping is an owner decision with notice.
3. **Starter on the marketing page — resolved 2026-11-08.** `/pricing` renders
   the three commercial cards from the catalogue, and a test fails if a retired
   tier reappears in the marketing data.
4. **Starter's environments.** Dropped from the catalogue and the comparison
   table: it was never enforced, so it is not claimed.
5. **Price discrepancy with `PRD.md` §11 — resolved 2026-11-08.** The PRD now
   matches this catalogue and ADR-057: Beginner ₦0/$0, Starter ₦5,000/$5, Pro
   ₦20,000/$18; Premium and Scale are retired. No prices changed.
6. **Advertised but unenforced distinctions.** Scoped keys, webhook replay,
   audit logs and per-plan environments were available to every organization
   regardless of tier. They are now either described as available on every plan
   (scoped keys, webhook replay, audit logs) or removed (environments, log
   retention). `UNENFORCED_PLAN_DIFFERENCES` in
   `packages/config/src/features.ts` records the remaining decisions.
