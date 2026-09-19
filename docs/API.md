# API Conventions

Conventions only, endpoint-level detail lives in generated docs/SDK types, which are the source of truth.

## Versioning

`/v1/emails`, `/v1/domains`, `/v1/templates`, `/v1/events`, `/v1/webhooks`, `/v1/otp`, `/v1/suppressions`, `/v1/projects`, `/v1/api-keys`.

## Authentication

`Authorization: Bearer <api_key>`, prefixed by environment/type:

```
calder_pk_test_... calder_sk_test_...
calder_pk_live_... calder_sk_live_...
```

## Idempotency

`Idempotency-Key: <client-generated-key>` on mutating requests where duplication causes harm. Claims are atomic: the first request wins, and any other request with the same key replays the stored response (`200` with the original body), never double-executes, so a retried send can never produce duplicate mail. A key whose first request is still in flight returns `409` with `error.code: "idempotency_conflict"`, retry the same key after a moment. Keys expire 24h after first use.

## Send-time errors

Beyond validation (`400`), send endpoints can fail at ingest with:

- `422 { error: { code: "suppressed" } }`, the recipient is on the project's suppression list; the message gives the reason (`bounce`/`complaint`/`unsubscribe`/`manual`). Nothing is persisted or queued for a suppressed send.
- `409 { error: { code: "idempotency_conflict" } }`, see above.

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

`test` keys never trigger real external delivery, simulated events and webhook deliveries only.

## Sender rules (`from`)

The `from` address must resolve to an identity the project's active transport owns:

- **Verified domain** (SES/managed transports): any address on the domain.
- **Connected Gmail** (gmail transport): exactly the connected address, the
 transport pins the sender, spoofing is structurally impossible.

Unowned senders fail closed (`domain_not_verified` / `550`) with an explanation
pointing at verification or graduation, never silent, never delivered anyway.

## SMTP (not REST, see docs/SMTP.md)

The SMTP gateway is a separate interface, not part of this REST surface. SMTP
credential management endpoints (create/rotate/revoke per project) will be
specified alongside gateway implementation, no paths are stable yet, so none
are listed here. Protocol behavior, normalization, and limits: `docs/SMTP.md`.
