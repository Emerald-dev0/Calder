# Calder, Security

Read before touching authentication, authorization, secrets, payments, email sending, or tenant isolation.

## 1. What Calder handles

Credentials, email addresses, domains, application data, potentially email content, billing information. Treat all of it as sensitive by default.

## 2. Secrets

No raw secret keys stored, API keys hashed at rest, only a prefix kept for identification. Webhook signing secrets and payment credentials never logged or exposed to clients. Managed through dedicated secret management, never hardcoded or committed. This includes CLI credentials (`gh auth`, `vercel login`, database connection strings, Redis URLs, the error-tracking DSN), see `AGENTS.md` CLI-first tooling.

Connection strings are treated as secrets even though only their host is ever
printed: readiness endpoints report `scheme://host:port` (via
`redactConnectionUrl`) and never userinfo, query parameters or passwords.
Boot/launch diagnostics report the Redis target with `redisTargetLabel()`,
which strips credentials.

## 2a. Observability redaction (Phase 2)

- Health endpoints (`/health`, `/ready`, worker `/health`, `/ready`, `/status`)
  never include credentials, full connection strings, internal topology or
  secret values; unrun checks report `skipped` with a reason rather than a
  fabricated `ok`.
- Error tracking is opt-in (`SENTRY_DSN`). When disabled, failures are logged
  with the same redaction rules and nothing leaves the process.
- Before an event is sent to the tracking service it passes through a scrubber
  that: drops request data/cookies/headers, strips query strings from URLs,
  reduces URLs to origin+path, and redacts credential-shaped text in messages,
  extra fields and contexts. Regression tests live in
  `packages/observability/src/redact.test.ts`.
- Captured context is limited to identifiers that an operator needs
  (`request_id`, service, environment, release, organization/project/email/job
  ids). Message bodies, recipient addresses, API keys, signing secrets, auth
  codes and provider credentials must never be attached.
- Logs are the same rule: never log raw API keys, webhook signing secrets,
  session cookies, OTP codes or provider credentials.

## 3. API keys

`test`/`live`, cryptographically distinct, scoped to environment. Creation/last-used timestamps, revocation, rotation supported. Fine-grained permissions are future work.

## 4. Authentication, authorization, and MFA boundary

Standard, non-custom session/token mechanisms. Every data access scoped by organization/project at the data-access layer, not only route guards.

MFA is intentionally **deferred**. The current architecture has no factor
secret/enrollment state, recovery-code storage, trusted-device policy, or
transactional step-up challenge in the schema or auth service. Adding only a
UI toggle or an unchecked claim would be a fake control, so Phase 3 does not
advertise MFA. The owner action is to choose and threat-model a factor model
(TOTP/passkeys, recovery, enrollment/unenrollment, rate limits, notifications,
and session step-up semantics), add forward-only schema migrations, then
implement and test it at the auth trust boundary before enabling it.

## 5. Tenant isolation

**A request in one organization must never read, modify, or infer the existence of another organization's resources.** Any new query or endpoint is reviewed against this before merging.

## 6. Webhooks

Outgoing webhooks are signed (HMAC-SHA256). The signing secret is shown to the customer exactly once at creation, is stored only AES-256-GCM encrypted (recoverable so our delivery engine can sign, never plaintext, never one-way hashed), and one encryption scheme is shared by the REST API and the dashboard manager (`webhook_signing` context). There is no read-back endpoint. Incoming webhooks (payment/email provider) are verified before being trusted, never processed on shape alone.

## 7. Abuse prevention

Mandatory. New-account creation blocks a curated disposable-domain set server-side; live sends from newly created organizations share a configurable organization-wide allowance. Verified recent SES feedback can atomically pause the organization after an adequate denominator. Organization status is checked at send admission and immediately before delivery/retry by both worker and drain. A founder/platform-admin/security operator can suspend an organization, atomically revoke all project API keys, and audit the action; resumed organizations require new keys after manual suspension. See `docs/PHASE1-ABUSE.md` for defaults, limitations, and operator response. This is a deterministic Phase 1 floor, not a comprehensive abuse-scoring or content-filtering system.

## 8. Input handling

All external input validated at the API boundary. Output encoding wherever user-controlled content could render as HTML (dashboard, email previews).

## 9. Transport & headers

Encrypted transport everywhere. Standard security headers on all web-facing surfaces.

## 10. Dependencies and secret scanning

Every CI verification run executes both `node scripts/security-audit.mjs` and
Gitleaks with `.gitleaks.toml`. The dependency gate fails on any **high or
critical** advisory; low and moderate findings remain visible and require a
named owner plus an expiry/remediation issue before they may be accepted. A
credential finding fails CI regardless of severity. The exact allowlist contains
only deterministic, non-production redaction/provider-test fixtures; it does
not allowlist a directory, file type, or broad token pattern.

The Phase 3 lockfile audit changed from the branch baseline of **48 findings**
(2 low, 25 moderate, 17 high, 4 critical) to **0 findings** after upgrading
Next.js, Vitest/Vite and Drizzle ORM and pinning patched PostCSS, esbuild and
brace-expansion resolutions. The audit must be rerun after every dependency
change; no `pnpm audit` failure may be hidden with `|| true` in CI.

If a future high/critical advisory cannot be upgraded immediately, the
security owner must record the advisory ID, affected path, production exposure,
mitigation, owner, and a deadline in the PR/incident tracker. The exception is
time-bound and CI must be changed only to an explicit advisory-ID exception,
never a blanket severity bypass. If a secret is detected, stop the release,
revoke/rotate the credential at its issuer, identify access using audit logs,
remove it from the repository/history where feasible, and document customer
notification and follow-up in the incident record. Do not paste the secret into
an issue, log, PR, or chat.

No dependency is added without stating why the existing dependency set cannot
perform the job safely (see `AGENTS.md`).

## 11. Audit logs

Immutable-from-UI records for: `organization.created`, `member.invited`, `api_key.created`, `api_key.revoked`, `domain.added`, `domain.verified`, `template.published`, `subscription.changed`, `project.created`, and organization sending-state actions (`organization.sending.*`, including automatic SES pauses and manual suspend/resume).

## 12. Visual QA tooling, security note

Screenshot/preview tooling used for the `docs/DESIGN.md` visual QA loop must run against local or staging environments only, and must never capture or embed real customer data, live API keys, or production email content in a screenshot that gets attached to a PR.

## 13. Incident posture

Runbooks for API, Redis, database, queue/worker, provider, abuse, bad
deployment and data-recovery incidents live in `docs/OPERATIONS.md` §8, with an
alert catalog in §5 and the escalation path in §12.

Disaster recovery: the backup/restore chain is _documented and scripted_
(`scripts/backup-verify.mjs`, `scripts/restore-drill.mjs`) but a restore has not
been proven yet. Until one drill passes and its evidence is recorded, recovery
must not be described as supported. RPO/RTO numbers in `docs/OPERATIONS.md` §7
are provisional and owner-pending.

## 14. SMTP gateway security

The SMTP ingress is abuse-sensitive by nature and gets its own controls on top of
everything above:

- **No open relay, ever.** Every submission requires AUTH + TLS; unauthenticated
  `MAIL FROM` is rejected before DATA. Anonymous relay is impossible by construction,
  and covered by protocol tests that attempt it.
- **Credentials:** per-project secrets, shown once, hashed at rest, rotatable and
  revocable with immediate effect. Revocation must bypass all caches, a revoked
  credential authenticates nowhere, even within a TTL window.
- **Transport:** STARTTLS on 587 required; plaintext AUTH rejected. Certificates
  managed with rotation runbook; expiry monitored with alerts.
- **Limits:** per-IP connection caps, per-credential/project/org message and
  recipient limits, message-size caps, all through the central rate limiter.
- **Abuse detection:** auth-failure monitoring (credential stuffing), velocity
  anomalies, bounce/complaint monitoring shared with the API path, project
  suspension with appeal.
- **Sender authorization:** envelope-from must map to a verified project identity;
  cross-project and foreign-domain spoofing fails closed and is logged.
- **Leak response:** suspected credential leak → revoke → rotate → audit sends made
  with the credential → notify the project owner. Runbooked, drilled.
- **Logging:** SMTP codes and auth outcomes logged; secrets and message bodies never logged.

## 15. Gmail transport security

Connected Gmail accounts are user credentials held in trust, stricter rules apply:

- **OAuth only, minimum scope** (`gmail.send` + identity). Passwords are never
  requested, never accepted, never stored. If Google stops returning refresh
  tokens, the flow errors loudly instead of degrading silently.
- **Encrypted at rest** (AES-256-GCM, context-separated keys), decrypted only
  in-memory at send time. Dashboard and API never return token material.
- **Revocation is user-controlled first:** disconnecting in the dashboard marks the
  transport revoked immediately; Google-side revocation surfaces as an explicit
  `gmail_revoked` error (permanent, explainable), never a silent stall.
- **Conservative caps** (default 400/day) enforced pre-send; over-cap fails closed
  pointing at graduation. Gmail-connected projects get the strictest abuse
  monitoring in the system, unusual velocity pages before Google notices.
- **Sender pinning:** Gmail sends only as the connected address. Spoofing another
  sender through this path is impossible by construction, not by policy.

SMTP credential lifecycle events (`smtp_credential.created`, `.rotated`, `.revoked`)
belong in the §11 audit log event set once implemented.
