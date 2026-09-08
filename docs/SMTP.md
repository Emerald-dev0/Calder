# Calder SMTP Gateway — Protocol & Implementation Spec

Status: specified, not yet implemented. Architecture: `ARCHITECTURE.md` §5b.
Security: `SECURITY.md` §14. Operations: `docs/OPERATIONS.md` (SMTP sections).
Decision record: ADR-014.

## 1. Endpoint

| Setting                       | Value                                    |
| ----------------------------- | ---------------------------------------- |
| Host                          | `smtp.calder.com`                        |
| Port (STARTTLS, recommended)  | `587`                                    |
| Port (implicit TLS, reserved) | `465`                                    |
| Auth                          | `AUTH PLAIN`, `AUTH LOGIN` over TLS only |
| Username                      | Project-scoped SMTP username             |
| Password                      | Generated SMTP secret (shown once)       |

Plaintext AUTH is rejected. Anonymous relay is impossible by construction and
covered by tests that attempt it.

## 2. Supported subset (MVP)

`EHLO/HELO`, `STARTTLS`, `AUTH PLAIN`, `AUTH LOGIN`, `MAIL FROM`, `RCPT TO`,
`DATA`, `RSET`, `NOOP`, `QUIT`. MIME: multipart/alternative + multipart/mixed,
HTML + plain-text bodies, attachments (size cap TBD — open, ADR-014), CC/BCC/
Reply-To, custom headers, Message-ID (preserved if present, generated if absent),
UTF-8 throughout. Multiple RCPT TO supported up to the per-message recipient cap.

Explicitly out of MVP: `ETRN`, `VRFY`/`EXPN` (privacy), DSN detail beyond 250/5xx
mapping, mailing-list headers management.

## 3. Ingestion pipeline (shared with REST)

```
TCP accept → greeting → STARTTLS → AUTH → MAIL FROM → RCPT TO → DATA
  → MIME parse → validate → normalize to Email model → sender-authorization check
  → suppression check → persist → enqueue → `250 Queued`
```

After `persist`, the message is indistinguishable from an API-submitted one:
same queue, worker, provider, events, usage meter. The canonical billable event
is the accepted send — one meter for both interfaces.

Idempotency: SMTP has no native idempotency header. Duplicates are contained by
(retried) client behavior + short-window dedupe on (credential, Message-ID);
documented as best-effort, unlike REST keys. Clients needing guarantees use the API.

## 4. Sender authorization

Envelope-from must resolve to a verified identity of the credential's project:
the project's own verified domain, or the Calder-managed onboarding identity.
Anything else → `550` + logged rejection. This is the anti-spoofing core.

## 5. Errors (protocol → developer meaning)

| SMTP reply   | Meaning                          | Dashboard/docs explanation                     |
| ------------ | -------------------------------- | ---------------------------------------------- |
| `235`        | Authenticated                    | —                                              |
| `250 Queued` | Accepted into pipeline           | Track via message ID, not this reply           |
| `535`        | Bad credentials                  | Use project SMTP credentials; check revocation |
| `550`        | Rejected sender/recipient        | Unauthorized domain or suppressed recipient    |
| `452`        | Over quota / too many recipients | Quota or per-message cap hit                   |
| `421`        | Service unavailable              | Back off and retry; incident if persistent     |

Original codes are preserved in logs for debugging; users get the explanation.

## 6. Rate limits (via central limiter)

Per IP (connections), credential, project, organization (messages), per-message
recipients, message size. Redis-backed counters; revocation bypasses cache.

## 7. Observability mapping

Connection → auth outcome → SMTP code → Calder message ID → queue job →
provider ID → delivery event. Every hop logged with correlation; dashboard shows
the trace end to end.

## 8. Competitive baseline (researched, not claimed)

- Resend: `smtp.resend.com`, 587 STARTTLS / 465 implicit TLS, username literally
  `resend`, password = API key. Thin shim over their API.
- Postmark: `smtp.postmarkapp.com`, 25/587/2525, Server API Token or SMTP
  Token (access + secret key), `X-PM-*` headers for options, STARTTLS.
- Our differentiators: project-scoped credentials (not one reused key), visible
  retry/dead-letter story shared with REST, NGN billing, transactional-only
  reputation pool. No "first/only" claims — the table above is verifiable.

## 9. Out of scope

Automating personal Gmail accounts (explicitly not the product — see PRD).
Inbound/MX receiving. Custom protocol extensions (optional `X-Calder-*` headers
only, documented as extensions).
