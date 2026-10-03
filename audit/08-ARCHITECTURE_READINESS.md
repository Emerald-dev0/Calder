# 08 — Architecture readiness (email scope)

Question asked: what must be settled now because it is expensive to reverse after launch. Email-only per owner; SMS/OTP/push marked OOS (not decided here, not promised for launch).

## What exists today (verified)

1. **Provider abstraction is real code, not a plan.** `resolveEmailProvider()` single choke point (`packages/providers/src/resolve.ts:51-89`; prod throws without creds, dev logs mock); SES + Gmail + Mock behind `EmailProvider`/`EmailTransport` (`index.ts:1-26`); worker chain sender→default→global with test-env mock-only short-circuit (`worker.ts:30-110,324-332`); drain mirrors the chain with suspended/cap fail-closed (`drain.ts:113-115,176-259,371-392`).
2. **Message model is email-wired and sufficient.** from/to/cc/bcc/replyTo/subject/html/text/metadata/attachments/`scheduledFor`/`stream`/status/providerMessageId/env/transport/provider/attemptCount (`schema/emails.ts:15-67`) + event ledger + suppressions + idempotency keys.
3. **One pipeline for all ingress.** API and (future) SMTP converge: persist → enqueue → 202/250 → worker → provider → events → webhooks (ARCHITECTURE.md:7-14; SMTP half unbuilt — SMTP-001).
4. **Economics split correctly.** Throttle counts `emails` rows at ingest-acceptance; invoice counts ledger `ur_<emailId>` at provider-accept; test-env never metered/sent (ADR-036; `usage.ts`, `quotas.ts`).

## Decisions to lock now (email scope)

1. **SNS wiring is manual and blocking.** DEPLOYMENT.md:130-196 topic→allowlist→subscribe→config-set→identity-default. Without it bounces/complaints never come back. Lock: dashboard pre-send guard (DOM-001a, Gate 1).
2. **Keep `stream` annotation-only.** Suppression/quota/sender gates run regardless (`docs/API.md:92-100`, `emails.ts:48-51`). Do not build stream-dependent enforcement later without a migration plan — reputation-pool separation must stay operational (separate identities/pools), never a silent code branch.
3. **Keep test-env isolation absolute** (mock-only, never metered). Load-bearing for tests and demos; any "send real mail from test key" exception breaks trust. (ADR-036.)
4. **Keep monotonic/sticky status; transient-bounce never suppresses** (ADR-035). Reversing this silently drops legitimate recipients.
5. **Meter at provider-accept, throttle at ingest-acceptance** (ADR-036, PRICING.md:101-119). Changing the billable event later creates invoice disputes.
6. **Gmail stays capped on-ramp with graded velocity; never silent-failover on suspend** (ADR-037). A silent SES fallback for suspended Gmail senders would launder abuse into the shared pool.
7. **SMTP gateway stays deferred; no SMTP credential endpoints until it exists** (`docs/API.md:138-143`). Listing credential endpoints early invites credential stuffing against a stub.
8. **Hosted-domain verification (ADR-005) stays informational-only** until a prototype proves SPF/DKIM/DMARC can work on a zone the developer doesn't control. Candidate (managed-subdomain mapping) must not ship as "verify your vercel.app" without the DNS proof.
9. **Ops trio before features:** rollback + backups + alerting channel (J-03/J-05/J-14) are the pre-launch email-risk items — not more pipeline features.

## Explicitly OOS (do not decide here)

SMS/push/WhatsApp provider shape, unified vs per-channel suppression/consent, per-channel billing, OTP-over-SMS security (length/expiry/attempts/pumping/SIM-swap), APNs/FCM lifecycle, NCC/DND compliance. PRD §16 already says not-now; keep it that way in all launch copy. Revisit only after email is publicly launched and metered.
