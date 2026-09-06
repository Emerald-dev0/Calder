# API Conventions

Conventions only — endpoint-level detail lives in generated docs/SDK types, which are the source of truth.

## Versioning

`/v1/emails`, `/v1/domains`, `/v1/templates`, `/v1/events`, `/v1/webhooks`, `/v1/otp`, `/v1/suppressions`, `/v1/projects`, `/v1/api-keys`.

## Authentication

`Authorization: Bearer <api_key>` — prefixed by environment/type:

```
avenor_pk_test_...   avenor_sk_test_...
avenor_pk_live_...   avenor_sk_live_...
```

## Idempotency

`Idempotency-Key: <client-generated-key>` on mutating requests where duplication causes harm. Repeated key returns original result.

## Error shape

```json
{
  "error": {
    "code": "domain_not_verified",
    "message": "The sending domain has not been verified.",
    "request_id": "req_..."
  }
}
```

## Rate limits

Per API key, project, and organization; different limits for sending vs. verification vs. dashboard endpoints. Responses include limit/remaining/reset.

## Sandbox / test mode

`test` keys never trigger real external delivery — simulated events and webhook deliveries only.

## SMTP (not REST — see docs/SMTP.md)

The SMTP gateway is a separate interface, not part of this REST surface. SMTP
credential management endpoints (create/rotate/revoke per project) will be
specified alongside gateway implementation — no paths are stable yet, so none
are listed here. Protocol behavior, normalization, and limits: `docs/SMTP.md`.
