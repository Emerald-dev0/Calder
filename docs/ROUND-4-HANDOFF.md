# Round 4 handoff

Status: **implemented and locally tested; not live-tested against Paystack,
SES or production hosting.** Nothing in this document claims a live merchant
account works.

## 1. Pricing (USD only) — implemented + tested
Beginner $0 / 5,000 monthly / 500 daily; Starter $5 / 10,000 / 2,000; Pro $18 /
50,000 / 5,000. `packages/config/src/plan-limits.ts` remains the single source.
Premium/Scale remain in the enum and catalogue, unpurchasable, historical rows
untouched. Public page and docs show USD only.

## 2. Prepaid credits — implemented + tested
Small $2/1,000, Medium $5/3,000, Large $15/10,000. Included allowance first,
credits second, FIFO by expiry, 12-month expiry, stacking, no auto-purchase,
no negative balances, idempotent purchase by payment reference.

## 3. Daily Burst Pass — implemented + tested
$1, +1,000 daily submissions, expires 23:59:59 UTC, max 2 per account per UTC
day, sold only at the daily boundary, never adds monthly credits, cannot bypass
monthly/suspension/compliance/provider/anti-abuse controls.

## 4. PostgreSQL queue — implemented + tested
`jobs` table, `SELECT … FOR UPDATE SKIP LOCKED`, leases, crash recovery, retry
classification with caller-supplied backoff, dead-letter inspect/requeue,
idempotency, bounded batches. No exactly-once claim. BullMQ retained until
production verification.

## 5. Processor execution and scheduling — implemented, partial
`POST /v1/jobs/process` with dedicated `QUEUE_PROCESSOR_SECRET`, bounded batch,
lease recovery. **Honest gap:** free hosting has no reliable minute-level
scheduler (Vercel Hobby cron is daily; GitHub Actions schedules are delayed).
Active traffic is drained on send; idle-account latency is not guaranteed.

## 6. Recipient-level accounting — implemented + tested
One recipient = one unit across single/batch/scheduled/retry/failure. Credits
reserved in the admission transaction; pre-provider failures release exactly
once; provider failures are visible, not silently reversed.

## 7. Ledger — implemented + tested
`credit_purchases` + append-only `credit_transactions`
(purchase/reservation/consumption/release/refund/adjustment/expiry), unique
payment reference, burst-pass records, audit trail. Frontend never authoritative.

## 8. Paystack — implemented, not live-tested; partially blocked
Documented endpoints only. Signed webhooks, raw-body replay dedupe, server-side
verify, amount/currency checks, integer minor units, idempotent fulfilment,
subscription lifecycle and refunds. **Blocked:** confirmation that the actual
merchant account has USD enabled, its settlement currency/FX, fees and recurring
USD capability. Checkout refuses with `usd_not_enabled` rather than converting.

## 9. Subscription enforcement — implemented, partial
Statuses modelled (`active`, `trialing`, `past_due`, `canceled`, expired,
suspended); no data deletion on expiry; Beginner limits after the paid period.
Grace/dunning policy remains an owner decision.

## 10. Frontend — implemented, partial
Public pricing copy, monthly-credit vs daily-pass explanation, limit/payment
states and dashboard billing/usage surfaces (plan, status, usage, credits,
purchase expiry, burst status, payment history). **Partial:** dashboard purchase
buttons are not wired; checkout is available through `POST /v1/billing/checkout`.
No UI implies a pass adds monthly credits or credits bypass daily limits.

## 11. Docs — implemented
PRICING, BILLING, CREDITS, ACCOUNTING, API-LIMITS, QUEUE, PAYSTACK, DEPLOYMENT,
OPERATIONS, DECISIONS (ADR-058/059/060), CHANGELOG and public docs pages.

## 12. Tests — implemented, not strictly test-first
Queue, credits and billing suites cover caps, expiry, concurrency, release,
no-negative, claim/lease/crash/retry/dead-letter/idempotency and mocked Paystack
success/failure/signature/replay/amount/currency/fulfilment/subscription/refund.
Local results: db 84 passed, API 286 passed (integration), dashboard 235 passed,
web 14 passed. Mocked Paystack tests prove nothing about a live account. Tests
were written alongside the implementation, not before it.

## 13. Migration discipline — implemented, partial
Existing queue/schema/billing/accounting/consumers audited. New migrations
`0035`–`0037` are additive/index-only; no job, email, usage or subscription row
is deleted. BullMQ/Redis removal is gated on production verification and is
**not done**.

## 14. $0 recurring infrastructure — implemented with honest limits
No paid worker, queue, scheduler or monitoring is required by the code. SES is
retained. Free scheduling cannot guarantee latency; failures surface through
`/v1/cron/alerts` and `jobMetrics().oldestPendingAgeSeconds`.

## Blocked on owner access (E)
- Paystack USD enablement, settlement/FX, fees, recurring USD.
- Live Paystack webhook delivery and refunds.
- Production SES sends, production database audit, load/restore drills.
- Vercel/Scheduler plan choice for per-minute processing.

## Future work
- Dashboard checkout buttons and a checkout return page.
- Webhook-delivery job handler on the new queue.
- BullMQ producer/worker removal after production verification.
- Dunning/grace-period policy and tax/VAT treatment.
