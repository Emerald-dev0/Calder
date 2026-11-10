# Prepaid credits

This page is a focused summary. The full rules, purchase catalogue, expiry and
UI states live in [BILLING.md](BILLING.md); the ledger implementation is
`packages/db/src/credits.ts`.

## Balance model

- One row per purchase in `credit_purchases` with `credits_remaining`.
- Every movement is an append-only `credit_transactions` row of type
  `purchase`, `reservation`, `consumption`, `release`, `refund`, `adjustment`
  or `expiry`. Positive amounts add, negative amounts consume.
- Available balance = sum of active, unexpired purchases with remaining > 0.
- The dashboard reads the balance from the database on every render; the
  frontend is never authoritative.

## Consumption order

1. Included monthly allowance (never shown as credits).
2. Prepaid credits, oldest expiry first.
3. If neither covers the request, the send is refused and nothing is debited.

A send consumes credits exactly once. A pre-provider failure (suppression,
disabled organization, transport resolution failure) releases the exact amount
once. Provider-side ambiguity after an SES attempt is visible in the email
record and is not silently reversed.

## Expiry

Each purchase expires 12 months after its purchase date. `expireCredits()`
zeroes the remaining balance, writes an `expiry` transaction, and marks the
purchase `expired`. Re-running it is a no-op. Expiry never deletes history.

## Why credits cannot bypass the daily limit

The daily cap protects provider reputation and is checked before any credit
balance. Only a Daily Burst Pass adds daily capacity, and a pass never becomes a
credit. This separation is enforced in `checkOrganizationQuota` and covered by
`packages/db/src/credits.integration.test.ts`.
