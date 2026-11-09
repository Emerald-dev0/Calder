# Sending limits and stable error responses

All errors use the envelope:

```json
{
  "error": {
    "code": "plan_limit_reached",
    "message": "Human-readable explanation",
    "request_id": "req_…",
    "details": {},
    "hint": "What to do next"
  }
}
```

`code` is stable. `details.window` distinguishes the two limit families. New
detail fields are additive; clients must ignore unknown fields.

## Daily limit reached

HTTP `402`, `code: "plan_limit_reached"`, `details.window: "daily"`.

```json
{
  "error": {
    "code": "plan_limit_reached",
    "message": "The Pro plan allows 5,000 accepted live emails per UTC day; 5,000 already accepted. Sending 1 more would exceed the daily limit.",
    "details": {
      "window": "daily",
      "limit": 5000,
      "usage": 5000,
      "dailyLimit": 5000,
      "burstCapacity": 0,
      "dailyCapacity": 5000,
      "passAvailable": true,
      "creditsAvailable": 0,
      "periodStart": "2026-11-08T00:00:00.000Z",
      "periodEnd": "2026-11-09T00:00:00.000Z"
    },
    "hint": "Buy a Daily Burst Pass to add 1,000 submissions for the rest of today, or wait for the reset at 2026-11-09T00:00:00.000Z. A pass never adds monthly credits."
  }
}
```

`passAvailable: false` means the two-pass daily cap has been used; retry after
the UTC reset.

## Monthly allowance exhausted, credits available

The request is **allowed**; the overage is debited from prepaid credits and the
response does not change shape. No client action is required.

## Monthly allowance exhausted, credits insufficient

HTTP `402`, `code: "plan_limit_reached"`, `details.window: "billing_period"`.

```json
{
  "error": {
    "code": "plan_limit_reached",
    "message": "The Beginner plan allows 5,000 emails per billing period; 5,000 already used this period. Sending 1 more would exceed the limit.",
    "details": {
      "window": "billing_period",
      "limit": 5000,
      "usage": 5000,
      "creditUnitsRequired": 1,
      "creditsAvailable": 0,
      "creditsExhausted": true,
      "periodStart": "2026-11-01T00:00:00.000Z",
      "periodEnd": "2026-12-01T00:00:00.000Z"
    },
    "hint": "Purchase prepaid credits to cover 1 more email, or wait for the period reset at 2026-12-01T00:00:00.000Z."
  }
}
```

`creditsExhausted: true` is the "out of credits" state. It is a subset of the
monthly refusal, not a separate code, so existing clients that handle
`plan_limit_reached` keep working.

## Account suspended

HTTP `403`, `code: "organization_suspended"` (or
`"organization_abuse_paused"`). No plan, credit balance or burst pass can
override this state.

## Payments

| Situation         | HTTP | Code                   |
| ----------------- | ---: | ---------------------- |
| Payments off      |  503 | `payments_unavailable` |
| USD not enabled   |  409 | `usd_not_enabled`      |
| Unknown pack      |  400 | `unknown_pack`         |
| Retired plan      |  400 | `tier_not_purchasable` |
| Webhook signature |  401 | `invalid_signature`    |
| Unknown reference |  404 | `payment_not_found`    |
| Payment pending   |  409 | `payment_pending`      |
| Payment failed    |  409 | `payment_failed`       |
| Not refundable    |  409 | `not_refundable`       |

## Test-env and internal traffic

Test-key submissions are never metered and never consume credits. Calder's own
transactional organization (`org_avenor`) is exempt from customer quotas.
