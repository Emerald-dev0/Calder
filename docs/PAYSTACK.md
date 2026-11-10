# Paystack integration

Status: **code and mocked tests implemented; live verification blocked.**

## 1. What was verified in documentation (2026-11-08)

- Paystack documents five transaction currencies: **NGN, GHS, ZAR, KES and USD**.
- USD acceptance is **account-dependent**: a merchant must have USD enabled for
  their account. Settlement normally happens in the currency of the business
  registration; USD settlement requires Paystack to enable it (a Nigerian
  domiciliary-account pilot and Kenyan USD settlement are documented externally).
- Amounts are **integer minor units** (cents for USD).
- Webhooks are signed with **HMAC-SHA512** over the raw request body using the
  secret key, in the `x-paystack-signature` header.
- Documented endpoints used: `POST /transaction/initialize`,
  `GET /transaction/verify/:reference`, `POST /refund`.
- Documented subscription events used: `subscription.create`, `subscription.notify`,
  `subscription.disable`, `invoice.payment_failed`. `charge.success` drives
  one-time fulfilment.

## 2. What is NOT verified (blocked — owner access required)

1. That **the actual merchant account has USD enabled**.
2. The **settlement currency and FX behaviour** for this account (USD collected
   vs NGN settled, and at what rate/fee).
3. The account's **fee schedule** for USD cards and international cards.
4. That **recurring USD subscriptions** are permitted for this account (plan
   currency must match the account's enabled currencies).
5. Real webhook delivery, retry timing and signature behaviour from Paystack.
6. Live refunds and their settlement timing.

No endpoint or event in this repository was invented. Nothing here proves a live
merchant account works.

## 3. Configuration

| Variable                | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `PAYSTACK_SECRET_KEY`   | Server-side API + webhook signature verification                    |
| `PAYSTACK_PUBLIC_KEY`   | Public key for hosted checkout (no secret material)                 |
| `PAYSTACK_USD_ENABLED`  | Must be `"true"`; otherwise checkout refuses with `usd_not_enabled` |
| `PAYSTACK_PLAN_STARTER` | Paystack plan code for the $5 Starter subscription                  |
| `PAYSTACK_PLAN_PRO`     | Paystack plan code for the $18 Pro subscription                     |
| `PAYSTACK_CALLBACK_URL` | Optional return URL after checkout                                  |

No credentials are committed. Webhook signature verification uses
`PAYSTACK_SECRET_KEY`; Paystack does not issue a separate webhook secret.

## 4. Flow

1. `createCheckout` validates the product, records a `payments` row with
   `status: "pending"` and an integer USD amount, then calls
   `transaction/initialize`.
2. The user pays on Paystack's hosted page.
3. `POST /v1/paystack/webhook` verifies the raw-body signature, inserts a receipt
   keyed by a hash of the raw body (replay dedupe), then calls
   `verifyAndFulfil`.
4. `verifyAndFulfil` calls `transaction/verify/:reference`, compares **amount and
   currency** to our row, flips the payment to `success` only if still `pending`,
   and grants credits/pass/subscription **in the same database transaction**.
5. The browser redirect is never trusted. A user returning early gets the
   pending state until verification succeeds.

## 5. Idempotency and replay

- Unique `payments.reference`.
- `payment_webhook_events.id = paystack:<event>:<sha256(rawBody)>` for replay
  dedupe.
- Fulfilment uses `UPDATE … WHERE status = 'pending' RETURNING`, so only one
  caller can fulfil.
- Credit purchase rows are unique on `payment_reference`; burst passes too.

## 6. Refunds

`refundPayment` requires a successful payment, sends an integer amount to
`POST /refund`, marks the payment `refunded`, zeroes unused credits from that
purchase, and marks a burst pass refunded. Consumed credits are not clawed back;
this is an owner policy decision.

## 7. Honest blockers

- Without `PAYSTACK_USD_ENABLED=true` and a USD-enabled merchant account, the
  product cannot be sold in USD. The system refuses rather than silently charging
  NGN.
- If Paystack cannot settle USD for this business, pricing must either remain
  USD-denominated with disclosed FX conversion or move to another provider. That
  is an owner decision, not a code change.
