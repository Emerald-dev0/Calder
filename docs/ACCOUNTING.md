# Recipient-level accounting

## Unit definition

One **recipient** is one billable unit, independent of whether the request is a
single send, a batch call, a scheduled send, a retry, or a failure.

The database stores one `emails` row per recipient (`to` is a single address).
Bulk and batch endpoints loop over recipients and call the same admission path
once per recipient, so:

| Request                    |                                  Units |
| -------------------------- | -------------------------------------: |
| One send, one `to`         |                                      1 |
| Batch with 100 recipients  |                                    100 |
| Suppressed recipient       |           0 (skipped before admission) |
| Pre-provider failure       |                           0 (released) |
| Retry after provider error | 0 additional; the original unit stands |
| Scheduled send             |        1 at admission, not at delivery |

## Reservation → finalize/release

1. **Admission** (inside the organization row lock): monthly and daily checks
   run, the email row is inserted, and any credit overage is deducted in the
   same transaction. This is the reservation.
2. **Finalize**: the email row remains the durable record. Usage metering
   (`usage_records`) is written only after provider acceptance.
3. **Release**: pre-provider terminal failures call `releaseCreditsForEmail`,
   which restores the exact allocation and is idempotent.

There is no double counting: one email id can be consumed once and released
once. Credits are never debited for a send that never reached a provider.

## Source of truth

PostgreSQL. The API response, dashboard counters and error details are
projections of `emails`, `usage_records`, `credit_purchases` and
`credit_transactions`. No client-side calculation can grant capacity.

## Test coverage

- `packages/db/src/credits.integration.test.ts`: caps, pass purchase/expiry,
  rollover, credit expiry, multi-pack stacking, concurrent reservations,
  release, no double consumption, no negative balance.
- `apps/api/src/services/billing.integration.test.ts`: amount/currency checks,
  duplicate fulfilment, subscription activation, webhook replay.
- `packages/db/src/jobs.integration.test.ts`: queue claim/concurrency/lease/
  crash/retry/dead-letter/idempotency/batch.
