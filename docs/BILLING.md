# Billing, credits and daily burst passes

Status: **implemented, not live-tested against a Paystack merchant account.**
The code paths, database ledger and tests exist; live USD settlement, live card
charges and real Paystack webhook delivery are blocked on owner credentials
(see [PAYSTACK.md](PAYSTACK.md)).

## 1. Plans (USD only)

| Plan     | Monthly | Included emails / month | Daily submission cap |
| -------- | ------: | ----------------------: | -------------------: |
| Beginner |      $0 |                   5,000 |                  500 |
| Starter  |      $5 |                  10,000 |                2,000 |
| Pro      |     $18 |                  50,000 |                5,000 |

Source of truth: `packages/config/src/plan-limits.ts`. Premium and Scale remain
in the enum and catalogue for historical subscriptions but are not purchasable
and are never rendered. No migration deletes or downgrades them.

Public pricing shows USD only. The retained NGN catalogue values are not charged
and are not shown.

## 2. Monthly credits (prepaid)

| Pack   | Price | Emails |
| ------ | ----: | -----: |
| Small  |    $2 |  1,000 |
| Medium |    $5 |  3,000 |
| Large  |   $15 | 10,000 |

Rules enforced in `packages/db/src/credits.ts`:

- The included monthly allowance is consumed first; credits cover only the
  overage above it.
- Credits **never** extend the daily submission cap. Daily capacity comes only
  from the plan cap plus active Daily Burst Passes.
- Purchases carry forward and expire **12 months after the purchase date**.
- Multiple packs stack. Consumption is FIFO by expiry date.
- A balance never goes negative: deductions are single conditional statements;
  an insufficient request is refused with no partial debit.
- Each email consumes at most once (unique `(type, reference_id)` semantics per
  purchase) and is released at most once (explicit release check inside the
  admission transaction).
- No auto-purchase and no auto-overage. Nothing is bought without an explicit
  checkout.

## 3. Daily Burst Pass

- $1 for **+1,000 submissions on the current UTC day only**.
- Expires at 23:59:59 UTC; no rollover.
- Maximum **2 per account per UTC day**.
- Purchasable only when the daily limit has been reached or is insufficient for
  the request. The refusal payload sets `passAvailable: true` when another pass
  may still be bought.
- Does **not** add monthly credits.
- Cannot bypass the monthly allowance, account suspension, compliance checks,
  provider limits, or anti-abuse controls.

## 4. Subscription lifecycle

| Status     | Effect                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| `trialing` | Plan limits apply; no invoice yet.                                          |
| `active`   | Plan limits apply; renews at `current_period_end`.                          |
| `past_due` | Sending continues at plan limits until the grace decision; billing retries. |
| `canceled` | Paid period runs to `current_period_end`, then Beginner limits apply.       |
| expired    | Beginner limits; data is never deleted.                                     |
| suspended  | Organization sending is blocked regardless of plan or credits.              |

Dunning, grace-period length and downgrade timing are owner decisions recorded
in [DECISIONS.md](DECISIONS.md). Expiry never deletes projects, domains, emails,
suppressions or history.

## 5. Checkout copy

> You will be charged in US dollars through Paystack. Monthly plans renew until
> you cancel. Prepaid credits are one-time purchases, carry forward, and each
> pack expires 12 months after purchase. A Daily Burst Pass is a one-time
> purchase for today only, expires at 23:59:59 UTC, and adds no monthly credits.

## 6. Limit-reached states

| State                       | Heading                            | Primary CTA            |
| --------------------------- | ---------------------------------- | ---------------------- |
| Daily cap reached           | You've reached your daily limit    | Get a Daily Burst Pass |
| Pass cap already used today | Daily Burst Pass limit reached     | Wait for the UTC reset |
| Monthly allowance exhausted | You've used your monthly allowance | Buy credits            |
| Credits exhausted           | You're out of credits              | Buy credits            |
| Payment pending             | Payment pending                    | Check payment status   |
| Payment failed              | Payment failed                     | Try again              |
| Account suspended           | Sending is paused                  | Contact support        |

The UI must never imply that a pass adds monthly credits or that credits bypass
the daily limit.

## 7. Error responses

Every refusal is stable and machine-readable; see
[API-LIMITS.md](API-LIMITS.md) for exact bodies.
